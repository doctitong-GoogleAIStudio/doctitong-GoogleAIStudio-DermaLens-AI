# DermaLens AI rebrand

## Patched builds (done — see `build/`)

`build/DermaLens AI v1.1.0-aligned.apk` and `build/DermaLens AI v1.1.0-unsigned.aab` were produced
by binary-patching the v1.0.10 builds: app label, launcher/adaptive/splash images, versionName 1.1.0,
versionCode 120 (the originals were 119 for the APK and 118 for the AAB — the 1010 in app.config was
never what Play saw), app.config name/version, and the three "AI Dermatologist" strings inside the
Hermes bundle (About title, About disclaimer, HTML report heading).

Sign them by running `build/sign.ps1` (prompts for the keystore password; nothing is stored).
Install the signed APK on a phone and check the About screen before uploading the AAB.

**Still apply the source changes below in Emergent** — otherwise the next build from Emergent
will come out as "AI Dermatologist" again, and its versionCode must be > 120.

---

# Changes to make in the Emergent project

## 1. Replace the icon files

Copy everything from `assets/images/` (this folder) over the same-named files in the
project's `assets/images/`:

| File                 | Purpose                                                   |
|----------------------|-----------------------------------------------------------|
| icon.png             | 1024x1024 — iOS / legacy Android / Expo `icon`             |
| adaptive-icon.png    | 1024x1024 — Android adaptive foreground (graphic only, text-free so launcher masks don't clip it) |
| splash-image.png     | 1024x1024 — splash screen image                            |
| favicon.png          | 48x48 — web                                                |
| play-store-icon-512.png | Upload in Play Console > Store listing > App icon       |

`_preview-adaptive-circle.png` is just a preview of the circular launcher mask; do not copy it.

## 2. app.json (or app.config.*)

```json
"name": "DermaLens AI",
"version": "1.1.0",
"android": {
  "versionCode": 1100,
  "adaptiveIcon": {
    "foregroundImage": "./assets/images/adaptive-icon.png",
    "backgroundColor": "#FFFFFF"
  },
  "package": "com.emergent.aidermatologistapp.r2pygs"
}
```

- `name` was `"AI Dermatologist v1.0.10"` — the version was baked into the launcher label.
- `versionCode` must be higher than 1010 for Play to accept the upload; 1100 keeps the pattern.
- Do NOT change `package` (or the iOS `bundleIdentifier`) — Play treats a new package as a new app.
- Leave `slug` alone (it only affects the EAS project link).

## 3. About screen text

Search the project for `AI Dermatologist` and replace with `DermaLens AI`. Occurrences found
in the compiled bundle:

1. About screen — app title.
2. About screen — disclaimer paragraph starting
   "AI Dermatologist provides a preliminary analysis of skin lesions using advanced artificial intelligence…".
3. Shareable HTML report template: `<h1>AI Dermatologist</h1>` (the report the app generates/shares).

If the About screen shows the version with a hard-coded string, change it to `v1.1.0`
(or better, read `Constants.expoConfig.version` from `expo-constants` so it follows app.json).

## 4. Rebuild and sign

Rebuild the Android AAB (and APK if you want a sideload build) with the SAME keystore
(`ai-dermatologist-release.keystore`) — Play requires the upload key to match.

## Prompt you can paste into Emergent

> Rename the app from "AI Dermatologist" to "DermaLens AI". In app.json set name to
> "DermaLens AI", version to "1.1.0", and android.versionCode to 1100 (keep the package
> name unchanged). Replace assets/images/icon.png, adaptive-icon.png, splash-image.png and
> favicon.png with the new files I'm uploading. Replace every occurrence of "AI Dermatologist"
> in the app UI with "DermaLens AI" — including the About screen title, the About screen
> disclaimer paragraph, and the <h1> in the HTML report template. Make the About screen show
> version v1.1.0. Then rebuild the Android AAB and APK with the existing release keystore.
