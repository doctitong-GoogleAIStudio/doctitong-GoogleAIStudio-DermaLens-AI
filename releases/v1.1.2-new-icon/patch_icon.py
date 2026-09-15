"""
Replaces the Android launcher icon inside "DermaLens AI v1.1.2.apk" / ".aab" with
DermaLens_AI_under_1MB.png, writing unsigned outputs into build/:

  build/DermaLens AI v1.1.2 new-icon-unsigned.apk   (run zipalign + apksigner afterwards)
  build/DermaLens AI v1.1.2 new-icon-unsigned.aab   (run jarsigner afterwards)

Only the 15 mipmap webp entries (ic_launcher, ic_launcher_round, ic_launcher_foreground
x mdpi..xxxhdpi) are touched; every other zip entry is copied byte-for-byte with its
original compression method. Old META-INF signature files are dropped.
"""
import os, sys, zipfile
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
WORK = os.path.join(BUILD, "icon-work", "new")
SRC_PNG = os.path.join(ROOT, "DermaLens_AI_under_1MB.png")
IN_APK = os.path.join(ROOT, "DermaLens AI v1.1.2.apk")
IN_AAB = os.path.join(ROOT, "DermaLens AI v1.1.2.aab")
OUT_APK = os.path.join(BUILD, "DermaLens AI v1.1.2 new-icon-unsigned.apk")
OUT_AAB = os.path.join(BUILD, "DermaLens AI v1.1.2 new-icon-unsigned.aab")

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
LEGACY_DP = 48       # ic_launcher / ic_launcher_round
ADAPTIVE_DP = 108    # ic_launcher_foreground (full canvas; launcher shows the inner 72dp)
FOREGROUND_SCALE = 70 / 108   # logo occupies 70dp of the 108dp canvas -> the wordmark + tagline clear a 72dp circle mask
ROUND_INSET = 0.92            # shrink a little before the circular crop so the wordmark isn't clipped

os.makedirs(WORK, exist_ok=True)
src = Image.open(SRC_PNG).convert("RGBA")
bg = src.getpixel((0, 0))[:3] + (255,)   # colour of the source's own margin (near white)
print("source", src.size, "margin colour", bg)


def fit_on_canvas(size, scale):
    """Scale the logo to `scale` of a square canvas of `size`, centred, margin filled with bg."""
    canvas = Image.new("RGBA", (size, size), bg)
    inner = max(1, round(size * scale))
    logo = src.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(logo, (off, off))
    return canvas


def circle_crop(im):
    size = im.size[0]
    ss = 4
    mask = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = im.copy()
    out.putalpha(mask)
    return out


def save_webp(im, path):
    im.save(path, "WEBP", lossless=True, quality=100, method=6)


# name -> {density: file}
new_files = {"ic_launcher": {}, "ic_launcher_round": {}, "ic_launcher_foreground": {}}
for dens, mult in DENSITIES.items():
    legacy = int(LEGACY_DP * mult)
    adaptive = int(ADAPTIVE_DP * mult)
    d = os.path.join(WORK, dens)
    os.makedirs(d, exist_ok=True)

    p = os.path.join(d, "ic_launcher.webp")
    save_webp(fit_on_canvas(legacy, 1.0), p)
    new_files["ic_launcher"][dens] = p

    p = os.path.join(d, "ic_launcher_round.webp")
    save_webp(circle_crop(fit_on_canvas(legacy, ROUND_INSET)), p)
    new_files["ic_launcher_round"][dens] = p

    p = os.path.join(d, "ic_launcher_foreground.webp")
    save_webp(fit_on_canvas(adaptive, FOREGROUND_SCALE), p)
    new_files["ic_launcher_foreground"][dens] = p
    print(f"{dens}: legacy {legacy}px, foreground {adaptive}px")

# A preview of what an Android launcher will show (72dp circle out of the 108dp foreground).
fg = fit_on_canvas(432, FOREGROUND_SCALE)
inner = fg.crop((72, 72, 360, 360))
circle_crop(inner).save(os.path.join(WORK, "_preview-adaptive-circle.png"))
inner.save(os.path.join(WORK, "_preview-adaptive-square.png"))

# ---- AAB: entries are addressed by name --------------------------------------------------
aab_map = {}
for name, per_density in new_files.items():
    for dens, path in per_density.items():
        aab_map[f"base/res/mipmap-{dens}-v4/{name}.webp"] = path

# ---- APK: resource file names are obfuscated (res/xx.webp); match on (size, crc) ---------
zin = zipfile.ZipFile(IN_AAB)
sig_by_aab_name = {}
for i in zin.infolist():
    if i.filename in aab_map:
        sig_by_aab_name[(i.file_size, i.CRC)] = i.filename
zin.close()

apk_map = {}
zin = zipfile.ZipFile(IN_APK)
for i in zin.infolist():
    key = (i.file_size, i.CRC)
    if i.filename.startswith("res/") and i.filename.endswith(".webp") and key in sig_by_aab_name:
        apk_map[i.filename] = aab_map[sig_by_aab_name[key]]
zin.close()
if len(apk_map) != 15 or len(sig_by_aab_name) != 15:
    sys.exit(f"expected 15 icon entries in each archive, got apk={len(apk_map)} aab={len(sig_by_aab_name)}")


def is_old_signature(name):
    if not name.startswith("META-INF/"):
        return False
    base = name[len("META-INF/"):]
    return base == "MANIFEST.MF" or base.upper().endswith((".SF", ".RSA", ".DSA", ".EC"))


def rewrite(src_zip, dst_zip, replacements):
    zin = zipfile.ZipFile(src_zip)
    if os.path.exists(dst_zip):
        os.remove(dst_zip)
    zout = zipfile.ZipFile(dst_zip, "w")
    replaced = 0
    for info in zin.infolist():
        if is_old_signature(info.filename):
            continue
        if info.filename in replacements:
            with open(replacements[info.filename], "rb") as f:
                data = f.read()
            replaced += 1
        else:
            data = zin.read(info.filename)
        ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        ni.create_system = info.create_system
        zout.writestr(ni, data)
    zout.close()
    zin.close()
    print(f"{os.path.basename(dst_zip)}: replaced {replaced} entries")


rewrite(IN_APK, OUT_APK, apk_map)
rewrite(IN_AAB, OUT_AAB, aab_map)

