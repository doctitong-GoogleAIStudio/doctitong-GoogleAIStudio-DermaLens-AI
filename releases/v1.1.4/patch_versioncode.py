"""Patches versionCode in the Emergent v1.1.4 archives (AAB 115 / APK 116 -> 125) and writes
UNSIGNED copies into build/ (gitignored). The old per-build Emergent signature entries are
dropped; everything else is byte-identical with the original compression method kept.

Sign afterwards with scripts/sign-release.ps1 (jarsigner for the .aab, zipalign+apksigner for
the .apk) using the Play upload keystore.

Why: Emergent numbers its builds with its own counter (115/116) which is below the 123 already
used on Play by the patched v1.1.2 bundle, so Play would reject the upload.
"""
import os
import struct
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC_DIR = os.path.abspath(os.path.join(REPO, ".."))          # folder holding the Emergent downloads
BUILD = os.path.join(REPO, "build")
IN_AAB = os.path.join(SRC_DIR, "DermaLens AI v1.1.4.aab")
IN_APK = os.path.join(SRC_DIR, "DermaLens AI v1.1.4.apk")
OUT_AAB = os.path.join(BUILD, "DermaLens AI v1.1.4 vc125-unsigned.aab")
OUT_APK = os.path.join(BUILD, "DermaLens AI v1.1.4 vc125-unsigned.apk")
NEW_VC = 125
os.makedirs(BUILD, exist_ok=True)


def encode_varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def patch_proto_manifest(data, old_vc, new_vc):
    """aapt2 proto XML: the versionCode XmlAttribute carries the value twice —
    as a string (field 3, tag 0x1a) and as a compiled int (Primitive.int_decimal_value, tag 0x30)."""
    k = data.find(b"versionCode")
    if k < 0:
        sys.exit("versionCode attribute not found in proto manifest")
    seg = data[k:k + 80]
    old_s = str(old_vc).encode()
    new_s = str(new_vc).encode()
    str_pat = b"\x1a" + bytes([len(old_s)]) + old_s
    if seg.count(str_pat) != 1:
        sys.exit(f"expected one string value {old_vc} in versionCode attribute, found {seg.count(str_pat)}")
    seg = seg.replace(str_pat, b"\x1a" + bytes([len(new_s)]) + new_s)
    int_pat = b"\x30" + encode_varint(old_vc)
    if seg.count(int_pat) != 1:
        sys.exit(f"expected one compiled int {old_vc} in versionCode attribute, found {seg.count(int_pat)}")
    seg = seg.replace(int_pat, b"\x30" + encode_varint(new_vc))
    if len(seg) != 80:
        sys.exit("patch changed the attribute length; the surrounding length prefixes would need re-encoding")
    return data[:k] + seg + data[k + 80:]


def patch_binary_manifest(data, old_vc, new_vc):
    """Android binary XML: versionCode is the only TYPE_INT_DEC (0x10) attribute equal to old_vc."""
    pat = struct.pack("<HBBI", 8, 0, 0x10, old_vc)
    if data.count(pat) != 1:
        sys.exit(f"expected exactly one int attribute {old_vc} in binary manifest, found {data.count(pat)}")
    return data.replace(pat, struct.pack("<HBBI", 8, 0, 0x10, new_vc))


def is_old_signature(name):
    if not name.startswith("META-INF/"):
        return False
    base = name[len("META-INF/"):]
    return base == "MANIFEST.MF" or base.upper().endswith((".SF", ".RSA", ".DSA", ".EC"))


def rewrite(src, dst, manifest_name, patch):
    zin = zipfile.ZipFile(src)
    if os.path.exists(dst):
        os.remove(dst)
    zout = zipfile.ZipFile(dst, "w")
    patched = False
    for info in zin.infolist():
        if is_old_signature(info.filename):
            continue
        data = zin.read(info.filename)
        if info.filename == manifest_name:
            data = patch(data)
            patched = True
        ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        ni.create_system = info.create_system
        zout.writestr(ni, data)
    zout.close()
    zin.close()
    if not patched:
        sys.exit(f"{manifest_name} not found in {src}")
    print(f"wrote {dst}")


rewrite(IN_AAB, OUT_AAB, "base/manifest/AndroidManifest.xml", lambda d: patch_proto_manifest(d, 115, NEW_VC))
rewrite(IN_APK, OUT_APK, "AndroidManifest.xml", lambda d: patch_binary_manifest(d, 116, NEW_VC))
