# DermaLens AI v1.1.2 — new launcher icon build

| File | Purpose |
|------|---------|
| `DermaLens AI v1.1.2 new-icon.apk` | Sideload / test build (zipaligned, APK Signature Scheme v2 + v3) |
| `DermaLens AI v1.1.2 new-icon.aab` | Play Console upload (jarsigned, passes `bundletool validate`) |
| `DermaLens_AI_under_1MB.png` | Source artwork for the launcher icon (1015×1015) |
| `patch_icon.py` | Script that generated the mipmap webp files and swapped them into the v1.1.2 archives |

Both binaries are stored with Git LFS.

## What is in this build

The Emergent v1.1.2 build still shipped the old "AI Dermatologist" launcher icon (the splash
screen already had the new logo). These files are the v1.1.2 archives with only the 15
launcher images replaced (`ic_launcher`, `ic_launcher_round`, `ic_launcher_foreground` ×
mdpi…xxxhdpi); every other entry is byte-identical to the Emergent build.

- `versionCode` 123 / `versionName` 1.1.2 — unchanged.
- Signed with `ai-dermatologist-release.keystore` (CN=AI Dermatologist, O=Vicente C. Cavalida Jr. MD),
  **not** the Emergent key that signed the original v1.1.2. The keystore is intentionally not in
  this repository.
- The adaptive-icon foreground places the logo at 70dp of the 108dp canvas so the wordmark and
  tagline are not clipped by circular launcher masks.

## Making it permanent

This is a binary patch. To have the next Emergent build come out with the right icon, replace
`frontend/assets/images/icon.png` and `adaptive-icon.png` in the project — see
[`docs/REBRAND-CHANGES.md`](../../docs/REBRAND-CHANGES.md).
