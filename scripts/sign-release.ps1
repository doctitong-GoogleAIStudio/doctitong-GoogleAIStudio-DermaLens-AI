<#
.SYNOPSIS
  Signs a DermaLens AI release artifact (.aab or .apk) with the Play upload key WITHOUT
  any credential living in the repository.

.DESCRIPTION
  Credentials are resolved in this order:
    1. Environment variables  DERMALENS_KEYSTORE, DERMALENS_KEYSTORE_PASS,
                              DERMALENS_KEY_ALIAS, DERMALENS_KEY_PASS
    2. A gitignored  signing.properties  next to this script or in the repo root
       (copy signing.properties.example, fill it in, never commit it)
    3. An interactive SecureString prompt (nothing is echoed or stored)

  Before signing, the script refuses to continue if the keystore's certificate SHA-256 does
  not match $ExpectedSha256 — this is the guard against accidentally shipping a build signed
  with the wrong key (Google Play rejects it, or worse, a new app identity is created).

  .aab -> jarsigner (JDK required; bundles are JAR-signed, apksigner cannot sign them)
  .apk -> apksigner from the Android SDK build-tools (v2+v3 signatures, zipaligned first)

.EXAMPLE
  pwsh scripts/sign-release.ps1 -Path "app-release.aab" -Output "DermaLens AI v1.1.3.aab"
  pwsh scripts/sign-release.ps1 -Path "app-release.apk" -Output "DermaLens AI v1.1.3.apk"
  pwsh scripts/sign-release.ps1 -Path x.aab -VerifyOnly     # just print the signer
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Path,
  [string] $Output,
  [switch] $VerifyOnly,
  # SHA-256 of the certificate Google Play Console lists as the *upload key certificate*.
  # Current value = ai-dermatologist-release.keystore / alias "aidermatologist".
  # Change it ONLY after a new upload key has been accepted in Play Console.
  [string] $ExpectedSha256 = "23:F2:EB:7F:7E:DF:D4:23:50:5B:0A:E2:70:49:68:37:5D:D1:3C:94:3B:9D:1E:A7:1D:56:89:9D:22:5A:31:D1"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Read-Props([string] $path) {
  $h = @{}
  if (Test-Path $path) {
    Get-Content $path | ForEach-Object {
      if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$') { $h[$Matches[1]] = $Matches[2] }
    }
  }
  return $h
}

function Resolve-Setting([string] $envName, [hashtable] $props, [string] $propName, [string] $prompt, [switch] $Secret) {
  $v = [Environment]::GetEnvironmentVariable($envName)
  if ($v) { return $v }
  if ($props.ContainsKey($propName) -and $props[$propName]) { return $props[$propName] }
  if ($Secret) {
    $s = Read-Host -Prompt $prompt -AsSecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  }
  return Read-Host -Prompt $prompt
}

function Find-Tool([string] $name, [string[]] $extraDirs) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($d in $extraDirs) {
    foreach ($ext in @("", ".exe", ".bat")) {
      $p = Join-Path $d "$name$ext"
      if (Test-Path $p) { return $p }
    }
  }
  throw "Could not find '$name'. Install a JDK (for keytool/jarsigner) or set ANDROID_HOME (for apksigner)."
}

$props = Read-Props (Join-Path $PSScriptRoot "signing.properties")
if ($props.Count -eq 0) { $props = Read-Props (Join-Path $repoRoot "signing.properties") }

$jdkDirs = @()
if ($env:JAVA_HOME) { $jdkDirs += (Join-Path $env:JAVA_HOME "bin") }
$jdkDirs += Get-ChildItem "C:\Program Files\Java", "C:\Program Files\Eclipse Adoptium", "C:\Program Files\Android\Android Studio\jbr" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName "bin" }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { "$env:LOCALAPPDATA\Android\Sdk" }
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { $_.FullName }

$keytool = Find-Tool "keytool" $jdkDirs

$keystore = Resolve-Setting "DERMALENS_KEYSTORE" $props "keystore" "Path to upload keystore"
if (-not (Test-Path $keystore)) { throw "Keystore not found: $keystore" }
$alias = Resolve-Setting "DERMALENS_KEY_ALIAS" $props "keyAlias" "Key alias"
$storePass = Resolve-Setting "DERMALENS_KEYSTORE_PASS" $props "storePassword" "Keystore password" -Secret
$keyPass = [Environment]::GetEnvironmentVariable("DERMALENS_KEY_PASS")
if (-not $keyPass) { $keyPass = if ($props["keyPassword"]) { $props["keyPassword"] } else { $storePass } }

# --- Guard: is this the key Google Play expects? -------------------------------------------
$certLine = & $keytool -list -v -keystore $keystore -alias $alias -storepass $storePass 2>&1 | Select-String "SHA256:"
if (-not $certLine) { throw "Alias '$alias' not found in $keystore (or wrong password)." }
$actual = ($certLine.ToString() -replace '.*SHA256:\s*', '').Trim().ToUpper()
Write-Host "Keystore certificate SHA-256: $actual"
if ($actual -ne $ExpectedSha256.ToUpper()) {
  throw "REFUSING TO SIGN: keystore certificate does not match the Play upload key ($ExpectedSha256). " +
        "If you intentionally rotated the upload key, pass -ExpectedSha256 with the value shown in Play Console > App signing."
}

if ($VerifyOnly) {
  Write-Host "Signer of ${Path}:"
  if ($Path -like "*.aab") { & (Find-Tool "jarsigner" $jdkDirs) -verify -verbose:summary -certs $Path }
  else { & (Find-Tool "apksigner" $buildTools) verify --print-certs $Path }
  exit 0
}

if (-not $Output) { $Output = $Path -replace '(\.aab|\.apk)$', '-signed$1' }

if ($Path -like "*.aab") {
  $jarsigner = Find-Tool "jarsigner" $jdkDirs
  Copy-Item $Path $Output -Force
  & $jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore $keystore -storepass $storePass -keypass $keyPass $Output $alias
  if ($LASTEXITCODE -ne 0) { throw "jarsigner failed" }
  & $jarsigner -verify -certs $Output | Out-Null
  Write-Host "Signed bundle: $Output"
}
elseif ($Path -like "*.apk") {
  $zipalign = Find-Tool "zipalign" $buildTools
  $apksigner = Find-Tool "apksigner" $buildTools
  $aligned = [IO.Path]::GetTempFileName() + ".apk"
  & $zipalign -f -p 4 $Path $aligned
  if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }
  # Passwords go through stdin, never the command line / process list.
  $pw = "$storePass`n$keyPass`n"
  $pw | & $apksigner sign --ks $keystore --ks-key-alias $alias --ks-pass stdin --key-pass stdin --v2-signing-enabled true --v3-signing-enabled true --out $Output $aligned
  if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }
  Remove-Item $aligned -Force
  & $apksigner verify --print-certs $Output
  Write-Host "Signed APK: $Output"
}
else { throw "Input must be an .aab or .apk" }
