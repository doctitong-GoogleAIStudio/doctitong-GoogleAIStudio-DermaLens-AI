# DermaLens AI v1.1.8 — versionCode 124 build

| File | Purpose |
|------|---------|
| `DermaLens AI v1.1.8-vc124.aab` | Play Console upload (jarsigned, passes `bundletool validate`) |
| `patch_versioncode.py` | Rewrites the Emergent v1.1.8 AAB with `versionCode` 124 |
| `sign_v118.ps1` | Signs the patched bundle with `ai-dermatologist-release.keystore` |
| `ANALYSIS.txt` | Full Google Play readiness review of the v1.1.8 build |

The bundle is stored with Git LFS.

## What is in this build

The Emergent v1.1.8 AAB shipped with `versionCode` 123 — the same number as v1.1.2 — while the
matching APK carried 124. This bundle is the Emergent v1.1.8 AAB with two entries rewritten:

- `base/manifest/AndroidManifest.xml` — `versionCode` 123 → 124 (`versionName` stays 1.1.8)
- `base/assets/app.config` — `versionCode` 118 → 124 (cosmetic; Play reads the manifest)

Every other entry is byte-identical to the Emergent build (verified by per-entry CRC).

- Package `com.emergent.aidermatologistapp.r2pygs`, minSdk 24, targetSdk 36, 16 KB-aligned native libs.
- Signed with `ai-dermatologist-release.keystore` (CN=AI Dermatologist, O=Vicente C. Cavalida Jr. MD,
  SHA-256 `23:F2:EB:7F:…:9D:22:5A:31:D1`), **not** the per-build Emergent key. The keystore is
  intentionally not in this repository.

## Play Console state at the time of this build (2026-09-17)

Neither listing in the `aivicventures` account had ever received a bundle, so no upload key was
registered. This file's signing key becomes the upload key on first upload to the
**AI Dermatologist** listing (`com.emergent.aidermatologistapp.r2pygs`). All later releases for
this package must be signed with the same keystore and use `versionCode` > 124.

The separate **DermaLens AI** listing uses package `com.dermalensai.app`; no existing build matches it.

## Known cosmetic issues (fix in the Emergent project, not here)

- `expo.name` is `"DermaLens AI v1.1.8"`, so the launcher label includes the version.
- `expo.scheme` is still the template default `frontend`.
