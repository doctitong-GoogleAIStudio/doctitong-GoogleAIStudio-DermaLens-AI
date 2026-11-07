#!/usr/bin/env python3
"""Measure the real Gemini token cost of one DermaLens analysis.

Sends the ACTUAL system instruction, prompt and response schema from
backend/server.py — not an approximation — with synthetic photos at several
resolutions, then reads `usageMetadata` back from the API. Image tokens depend
on pixel dimensions, not on what the photo shows, so a generated image measures
exactly what a real lesion photo of the same size would cost.

Answers two questions:
  1. What does one analysis actually cost today?
  2. How much would resizing photos before upload save?

MEASURED RESULT (gemini-3.1-pro-preview, 2026-11, 4 photos per call):
input tokens were 4,880 at EVERY resolution tested — 4032x3024, 1536x1152,
1024x768 and 768x576 all cost exactly the same. This model appears to
normalise images server-side rather than billing per tile, so downscaling
before upload saves nothing on the API bill. It still cuts upload time and
the user's mobile data (3,301 KB vs 214 KB per photo), which is a real UX
win, just not a cost one. Output was 163-315 tokens, varying with the
answer rather than the image.

Re-run this when changing model: the result above is model-specific and
should not be assumed to hold for another one.

Usage:
    export GEMINI_API_KEY=...            # or put it in backend/.env
    python3 scripts/measure-gemini-cost.py

    # see which models this key can use, then compare them
    python3 scripts/measure-gemini-cost.py --list-models
    python3 scripts/measure-gemini-cost.py --model <name-from-that-list>

    # turn tokens into money (rates from https://ai.google.dev/gemini-api/docs/pricing)
    python3 scripts/measure-gemini-cost.py --in-price 1.25 --out-price 10.00

This makes real, billed API calls. It is a handful of small requests — cents at
most — but it is not free. Pass --dry-run to see the plan without calling.

Windows (PowerShell):
    py -m pip install pillow httpx
    $env:GEMINI_API_KEY = "your-key-here"
    py scripts\\measure-gemini-cost.py --images 4

Requires only pillow and httpx. It reads the prompt constants straight out of
backend/server.py without importing it, so you do not need FastAPI, MongoDB or
anything else from the backend installed to run this.
"""

import argparse
import ast
import base64
import io
import os
import sys
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
SERVER_PY = BACKEND / "server.py"

try:
    import httpx
    from PIL import Image
except ImportError as e:
    sys.exit(f"Missing dependency: {e}\n\nInstall the two this script needs:\n"
             f"  python3 -m pip install pillow httpx       (Windows: py -m pip install pillow httpx)")


def load_prompt_pieces():
    """Read the real prompt constants out of server.py WITHOUT importing it.

    Importing server.py would drag in FastAPI, Motor, pydantic and friends just
    to read three values. Parsing is enough: all three are plain literals, and
    _build_analysis_prompt only touches HISTORY_LABELS and the object passed in.
    """
    if not SERVER_PY.is_file():
        sys.exit(f"Cannot find {SERVER_PY}. Run this from a clone of the repo.")
    tree = ast.parse(SERVER_PY.read_text(encoding="utf-8"))

    consts, fn_src = {}, None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in (
                        "ANALYSIS_SYSTEM", "GEMINI_RESPONSE_SCHEMA", "HISTORY_LABELS"):
                    try:
                        consts[t.id] = ast.literal_eval(node.value)
                    except ValueError:
                        pass
        elif isinstance(node, ast.FunctionDef) and node.name == "_build_analysis_prompt":
            fn_src = ast.get_source_segment(SERVER_PY.read_text(encoding="utf-8"), node)

    missing = {"ANALYSIS_SYSTEM", "GEMINI_RESPONSE_SCHEMA", "HISTORY_LABELS"} - consts.keys()
    if missing or not fn_src:
        sys.exit(f"server.py changed shape; could not read: "
                 f"{', '.join(sorted(missing)) or '_build_analysis_prompt'}")

    ns = {"HISTORY_LABELS": consts["HISTORY_LABELS"], "List": list}
    exec(fn_src, ns)  # noqa: S102 — our own repo's source, parsed above
    return (consts["ANALYSIS_SYSTEM"], consts["GEMINI_RESPONSE_SCHEMA"],
            ns["_build_analysis_prompt"], consts["HISTORY_LABELS"])


def load_env_file() -> None:
    """Pick up GEMINI_API_KEY from backend/.env if it is not already exported."""
    if os.environ.get("GEMINI_API_KEY"):
        return
    env = BACKEND / ".env"
    if not env.is_file():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("GEMINI_API_KEY=") and not line.startswith("#"):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                os.environ["GEMINI_API_KEY"] = value
            return


def jpeg_at(width: int, height: int, quality: int = 50) -> str:
    """A photo-like JPEG of the given size, base64-encoded.

    quality=50 matches `quality: 0.5` in frontend/app/capture.tsx.
    """
    img = Image.new("RGB", (width, height))
    px = img.load()
    # Smooth gradient plus texture, so the encoder produces a realistic size.
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            px[x, y] = ((x * 3 + y) % 256, (y * 5) % 256, (x ^ y) % 256)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


def scaled(longest_edge: int | None, base=(4032, 3024)) -> tuple[int, int]:
    """Phone photo scaled so its longest edge is `longest_edge` (None = original)."""
    w, h = base
    if longest_edge is None or max(w, h) <= longest_edge:
        return w, h
    f = longest_edge / max(w, h)
    return int(w * f), int(h * f)


def measure(client, model, api_key, images_b64, system, prompt, schema):
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{
            "parts": [{"text": prompt}]
                     + [{"inline_data": {"mime_type": "image/jpeg", "data": b}} for b in images_b64],
        }],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": schema,
            "temperature": 0.4,
        },
    }
    r = client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        json=body,
    )
    if r.status_code != 200:
        detail = r.text[:1500]
        if r.status_code == 429:
            # The useful part of a 429 is the quota metric name and limit,
            # which sits deep in the JSON and is easy to truncate away.
            try:
                for d in r.json().get("error", {}).get("details", []):
                    for v in d.get("violations", []):
                        detail = (f"quota '{v.get('quotaMetric', '?')}' "
                                  f"limit {v.get('quotaValue', '?')} "
                                  f"(model: {v.get('quotaDimensions', {}).get('model', '?')})")
                        break
            except ValueError:
                pass
        return None, f"HTTP {r.status_code}: {detail}"
    u = r.json().get("usageMetadata", {})
    return {
        "prompt": u.get("promptTokenCount", 0),
        "output": u.get("candidatesTokenCount", 0),
        "total": u.get("totalTokenCount", 0),
    }, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview"))
    ap.add_argument("--sizes", default="none,1536,1024,768",
                    help="comma-separated longest-edge values; 'none' = full resolution")
    ap.add_argument("--images", type=int, default=1,
                    help="photos per request (the app allows up to 4)")
    ap.add_argument("--in-price", type=float, help="USD per 1M input tokens")
    ap.add_argument("--out-price", type=float, help="USD per 1M output tokens")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true", help="show the plan, call nothing")
    ap.add_argument("--list-models", action="store_true",
                    help="list the models this API key can actually use, then exit")
    args = ap.parse_args()

    if args.list_models:
        load_env_file()
        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            sys.exit("GEMINI_API_KEY is not set (export it, or put it in backend/.env).")
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                      headers={"x-goog-api-key": key}, timeout=args.timeout)
        if r.status_code != 200:
            sys.exit(f"HTTP {r.status_code}: {r.text[:500]}")
        models = [m for m in r.json().get("models", [])
                  if "generateContent" in m.get("supportedGenerationMethods", [])]
        if not models:
            sys.exit("This key can use no generateContent models.")
        print(f"{'model':<40} {'in limit':>10} {'out limit':>10}  name")
        print("-" * 90)
        for m in sorted(models, key=lambda x: x["name"]):
            print(f"{m['name'].replace('models/', ''):<40} "
                  f"{m.get('inputTokenLimit', '?'):>10} "
                  f"{m.get('outputTokenLimit', '?'):>10}  "
                  f"{m.get('displayName', '')}")
        print("\nMeasure one with:  --model <name from the first column>")
        return 0

    system, schema, build_prompt, history_labels = load_prompt_pieces()

    # Duck-typed stand-in for AnalyzeIn. Every HISTORY_LABELS field is filled so
    # the prompt is the longest the app can realistically produce — the
    # worst-case (most expensive) text, and it cannot break if a field is added.
    realistic = {
        "location": "left forearm, extensor surface",
        "duration": "approximately 3 months",
        "symptoms": "mild intermittent itching, no pain or bleeding",
        "changes": "slowly enlarging, border has become less regular",
        "evolution": "started as a small flat brown macule",
        "medications": "none relevant",
        "other": "no family history of melanoma; works outdoors",
    }
    history = SimpleNamespace(**{k: realistic.get(k, "not specified") for k in history_labels})
    sample = SimpleNamespace(images=[None] * args.images, viewLabels=None, history=history)
    prompt = build_prompt(sample)

    sizes = [None if s.strip().lower() in ("none", "full", "0") else int(s)
             for s in args.sizes.split(",") if s.strip()]

    print(f"Model            : {args.model}")
    print(f"Photos per call  : {args.images}")
    print(f"Text overhead    : system {len(system):,} chars + prompt {len(prompt):,} chars "
          f"+ schema {len(str(schema)):,} chars")
    print(f"Calls to make    : {len(sizes)}")
    print()

    if args.dry_run:
        for s in sizes:
            w, h = scaled(s)
            print(f"  would send {args.images} x {w}x{h}")
        print("\nDry run — nothing was called and nothing was billed.")
        return 0

    load_env_file()
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("GEMINI_API_KEY is not set.\n", file=sys.stderr)
        print("Export it, or add it to backend/.env:", file=sys.stderr)
        print("  export GEMINI_API_KEY=...", file=sys.stderr)
        print("\nGet a key at https://aistudio.google.com/apikey", file=sys.stderr)
        return 1

    rows = []
    any_429 = False
    with httpx.Client(timeout=args.timeout) as client:
        for s in sizes:
            w, h = scaled(s)
            b64 = jpeg_at(w, h)
            kb = len(base64.b64decode(b64)) / 1024
            label = "full res" if s is None else f"{s}px"
            print(f"  calling {label:>9} ({w}x{h}, {kb:,.0f} KB each) ...", end="", flush=True)
            usage, err = measure(client, args.model, api_key,
                                 [b64] * args.images, system, prompt, schema)
            if err:
                print(f" FAILED\n    {err}")
                if err.startswith("HTTP 429"):
                    any_429 = True
                continue
            print(f" prompt {usage['prompt']:,} / output {usage['output']:,} tokens")
            rows.append((label, w, h, kb, usage))

    if not rows:
        print("\nNo successful calls.", file=sys.stderr)
        if any_429:
            print("""
A 429 means this API key has no quota for this model — not that you sent too
many requests. Two usual causes:

  1. Billing is not enabled on the key's Google Cloud project. Preview and Pro
     models often have a free-tier limit of zero, so the very first call fails.
     Enable billing, or create the key in a project that already has it.

  2. The model is not available to this key. Model names change and older
     ones get retired, so ask the key what it can use rather than guessing:

       --list-models

This affects the running app too, not just this script: /api/analyze calls the
same endpoint. Whatever model works here is the one to put in GEMINI_MODEL in
backend/.env.""", file=sys.stderr)
        return 1

    print()
    header = f"{'photo size':>10} {'pixels':>12} {'KB':>7} {'in tok':>9} {'out tok':>8} {'total':>9}"
    money = args.in_price is not None and args.out_price is not None
    if money:
        header += f" {'USD/call':>10} {'per 1k':>9}"
    print(header)
    print("-" * len(header))

    baseline = None
    for label, w, h, kb, u in rows:
        line = (f"{label:>10} {f'{w}x{h}':>12} {kb:>7,.0f} "
                f"{u['prompt']:>9,} {u['output']:>8,} {u['total']:>9,}")
        if money:
            cost = u["prompt"] / 1e6 * args.in_price + u["output"] / 1e6 * args.out_price
            line += f" {cost:>10.5f} {cost*1000:>9.2f}"
        print(line)
        if baseline is None:
            baseline = u["prompt"]

    print()
    for label, w, h, kb, u in rows[1:]:
        saving = (1 - u["prompt"] / baseline) * 100 if baseline else 0
        print(f"  resizing to {label:>7} cuts input tokens by {saving:5.1f}% "
              f"({baseline:,} -> {u['prompt']:,})")

    if not money:
        print("\nFor dollar figures, re-run with current rates, e.g.:")
        print("  --in-price 1.25 --out-price 10.00")
        print("  (https://ai.google.dev/gemini-api/docs/pricing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
