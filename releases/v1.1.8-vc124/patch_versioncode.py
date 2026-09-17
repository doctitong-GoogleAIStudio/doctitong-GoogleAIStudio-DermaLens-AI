"""
Bumps android:versionCode 123 -> 124 inside "DermaLens AI v1.1.8.aab" (the APK from Emergent
already carries 124), writing an unsigned bundle to build/:

  build/DermaLens AI v1.1.8-vc124-unsigned.aab   (run sign_v118.ps1 afterwards)

Two entries are rewritten:
  base/manifest/AndroidManifest.xml  protobuf XML: the versionCode attribute's string value
                                     ("123" -> "124") and its compiled int (varint 0x7b -> 0x7c)
  base/assets/app.config             JSON: "versionCode": 118 -> 124 (cosmetic; Play reads the manifest)
Every other zip entry is copied byte-for-byte with its original compression method. Old
META-INF signature files are dropped so jarsigner can produce a clean signature.
"""
import json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
IN_AAB = os.path.join(ROOT, "DermaLens AI v1.1.8.aab")
OUT_AAB = os.path.join(BUILD, "DermaLens AI v1.1.8-vc124-unsigned.aab")
OLD, NEW = 123, 124

zin = zipfile.ZipFile(IN_AAB)

# ---- manifest: protobuf XmlAttribute { name:"versionCode" value:"123" ... compiled_item{prim{int_decimal_value:123}} }
m = bytearray(zin.read("base/manifest/AndroidManifest.xml"))
i = m.find(b"\x12\x0bversionCode")
if i < 0:
    sys.exit("versionCode attribute not found in manifest")
# value string: tag 0x1a, len 3, "123"
old_val = b"\x1a\x03" + str(OLD).encode()
new_val = b"\x1a\x03" + str(NEW).encode()
j = m.find(old_val, i, i + 40)
if j < 0:
    sys.exit("versionCode string value 123 not found where expected")
m[j:j + len(old_val)] = new_val
# compiled item: 0x32 len 0x3a len 0x30 <varint>
old_prim = b"\x32\x04\x3a\x02\x30" + bytes([OLD])
new_prim = b"\x32\x04\x3a\x02\x30" + bytes([NEW])
k = m.find(old_prim, i, i + 60)
if k < 0:
    sys.exit("versionCode compiled int 123 not found where expected")
m[k:k + len(old_prim)] = new_prim
assert m.count(b"\x1a\x03123") == 0, "another '123' attribute value exists; refusing to guess"
manifest = bytes(m)

# ---- app.config: plain JSON
cfg = json.loads(zin.read("base/assets/app.config"))
cfg_root = cfg.get("expo", cfg)
print("app.config versionCode", cfg_root["android"].get("versionCode"), "->", NEW)
cfg_root["android"]["versionCode"] = NEW
app_config = json.dumps(cfg, separators=(",", ":")).encode()

replacements = {
    "base/manifest/AndroidManifest.xml": manifest,
    "base/assets/app.config": app_config,
}


def is_old_signature(name):
    if not name.startswith("META-INF/"):
        return False
    base = name[len("META-INF/"):]
    return base == "MANIFEST.MF" or base.upper().endswith((".SF", ".RSA", ".DSA", ".EC"))


if os.path.exists(OUT_AAB):
    os.remove(OUT_AAB)
zout = zipfile.ZipFile(OUT_AAB, "w")
replaced = dropped = 0
for info in zin.infolist():
    if is_old_signature(info.filename):
        dropped += 1
        continue
    if info.filename in replacements:
        data = replacements[info.filename]
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
print(f"{os.path.basename(OUT_AAB)}: replaced {replaced} entries, dropped {dropped} old signature files")
