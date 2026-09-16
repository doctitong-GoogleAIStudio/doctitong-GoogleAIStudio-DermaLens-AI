# DermaLens AI — Android signing

> Rebranding (AI Dermatologist → DermaLens AI, publisher → aivicventures) does **not** require a
> new signing key. The upload key is tied to the package `com.emergent.aidermatologistapp.r2pygs`,
> not to the app name or the organisation string inside the certificate. Keep signing with the key
> Google Play Console lists as the **upload key certificate** unless you deliberately run Google's
> upload-key reset process.

## How this project is signed today

This is an Expo **managed** project — there is no `android/` folder and therefore no Gradle
`signingConfigs` in the repo. Signing happens in two places:

| Producer | Certificate | SHA-256 |
|---|---|---|
| Emergent's build service (every raw build it hands you) | `CN=AI Dermatologist v1.0.1, O=Emergent` — Emergent-owned key | `46:30:40:EA:3A:91:7C:38:5A:B9:76:5A:E3:97:85:3D:CA:D3:5F:77:2B:52:84:57:4A:AF:BA:46:3F:2C:F5:47` |
| Local re-signing with `ai-dermatologist-release.keystore` (alias `aidermatologist`) — used for v1.0.10 "resigned", v1.1.0, v1.1.1, v1.1.2 | `CN=AI Dermatologist, O=Vicente C. Cavalida Jr. MD` | `23:F2:EB:7F:7E:DF:D4:23:50:5B:0A:E2:70:49:68:37:5D:D1:3C:94:3B:9D:1E:A7:1D:56:89:9D:22:5A:31:D1` |

**Which of the two is the Play upload key can only be read from Play Console** (Test and release →
Setup → App signing → *Upload key certificate*). Compare its SHA-256 with the table above before
the next upload. See the DERMALENS AI SIGNING REPORT delivered with this change.

## Signing a release without secrets in Git

```
pwsh scripts/sign-release.ps1 -Input "app-release.aab" -Output "DermaLens AI v1.1.3.aab"
```

`scripts/sign-release.ps1` takes credentials from `DERMALENS_KEYSTORE`, `DERMALENS_KEYSTORE_PASS`,
`DERMALENS_KEY_ALIAS`, `DERMALENS_KEY_PASS`, or from a gitignored `scripts/signing.properties`
(template: `scripts/signing.properties.example`), or prompts securely. It **refuses to sign** if
the keystore certificate's SHA-256 differs from the expected upload key, so a wrong keystore can
never produce a bundle by accident. Bundles are signed with `jarsigner` (JDK), APKs with
`zipalign` + `apksigner` (Android SDK build-tools).

Keep the keystore and its password outside the repository (they are gitignored: `*.keystore`,
`*.jks`, `*.keystore.txt`, `signing.properties`). Store the password in a password manager and
delete the plaintext `.keystore.txt` once it is there. Keep an encrypted off-machine backup of the
keystore — losing an upload key means a Play Console support case, losing a *non-Play-App-Signing*
key means the app can never be updated.

## If the project is ever ejected to a native `android/` folder

Never put passwords in `build.gradle`. Read them from `~/.gradle/gradle.properties` or the
environment:

```groovy
// android/app/build.gradle
def sp = System.getenv("DERMALENS_KEYSTORE_PASS") ?: project.findProperty("DERMALENS_KEYSTORE_PASS")
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("DERMALENS_KEYSTORE") ?: project.findProperty("DERMALENS_KEYSTORE") ?: "missing.keystore")
            storePassword sp
            keyAlias System.getenv("DERMALENS_KEY_ALIAS") ?: project.findProperty("DERMALENS_KEY_ALIAS")
            keyPassword System.getenv("DERMALENS_KEY_PASS") ?: project.findProperty("DERMALENS_KEY_PASS") ?: sp
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
```

With EAS Build, use `eas credentials` and let EAS hold the keystore instead — again nothing in Git.

## Creating a NEW upload key identified as aivicventures (prepared, NOT executed)

Only do this if you intentionally want the certificate to read `O=aivicventures`. It requires
Google's **upload key reset** (Play App Signing must be enabled — it is for every app created
after Aug 2021). Until Play confirms the new upload certificate, keep signing with the current key.

```bash
# 1. Generate (PKCS12, RSA 4096, SHA-256, ~27 years — well past Google's 2033-10-22 minimum)
keytool -genkeypair -v \
  -keystore dermalens-ai-upload.keystore -storetype PKCS12 \
  -alias dermalens-upload \
  -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000 \
  -dname "CN=DermaLens AI, O=aivicventures"

# 2. Export the PUBLIC certificate that Play Console asks for (no private material)
keytool -export -rfc -keystore dermalens-ai-upload.keystore -alias dermalens-upload \
  -file dermalens-ai-upload-cert.pem

# 3. Print the fingerprints to double-check against what Play shows after the reset
keytool -list -v -keystore dermalens-ai-upload.keystore -alias dermalens-upload | grep -E "SHA1|SHA256"
```

Then in Play Console: **Test and release → Setup → App signing → "Request upload key reset"** →
choose a reason → upload `dermalens-ai-upload-cert.pem` → wait for Google's confirmation
(typically ≤ 48 h; the new key becomes valid at the time stated in the email). Only after that:

1. update `$ExpectedSha256` in `scripts/sign-release.ps1` to the new certificate's SHA-256;
2. sign the next bundle with `dermalens-ai-upload.keystore`;
3. retire the old keystore (keep an encrypted archive copy).

The **app signing key** (the one Google uses to sign what users install) is unaffected by an
upload-key reset — users see no change and updates install normally.
