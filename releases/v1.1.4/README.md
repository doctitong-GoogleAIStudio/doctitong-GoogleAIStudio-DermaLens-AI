# DermaLens AI v1.1.4 — versionCode 125 re-sign

Emergent's v1.1.4 build came out as versionCode **115 (AAB) / 116 (APK)**, below the 123 already
used on Google Play by the patched v1.1.2 bundle, and signed with a fresh per-build Emergent key
(`CN=DermaLens AI v1.1.4, O=Emergent`). Play would reject it twice over.

`patch_versioncode.py` rewrites both archives with versionCode **125** (versionName 1.1.4 unchanged,
every other entry byte-identical, old signature entries dropped) into `build/`; they were then signed
with `scripts/sign-release.ps1` using `ai-dermatologist-release.keystore`
(`CN=AI Dermatologist, O=Vicente C. Cavalida Jr. MD`, SHA-256 `23:F2:EB:7F…`).

Outputs (not committed — kept next to the other builds in the parent folder):

- `DermaLens AI v1.1.4 vc125.aab` — Play Console upload (jarsigner, `jar verified`)
- `DermaLens AI v1.1.4 vc125.apk` — sideload build (zipalign + apksigner v2/v3)

This build does **not** contain the account-bound free-analysis fix (commit a1f133e) — that lands
in the next Emergent build. Ask Emergent to build with versionCode ≥ 126 next time.
