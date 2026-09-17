# Signs the versionCode-124 v1.1.8 AAB (from patch_versioncode.py) with ai-dermatologist-release.keystore.
# The keystore password is read from ai-dermatologist-release.keystore.txt ("Password:" line) and
# held only in this process's environment while jarsigner runs.
$ErrorActionPreference = "Stop"
$root  = Split-Path $PSScriptRoot -Parent
$java  = Join-Path $root "tools\jdk\bin\java.exe"
$jars  = Join-Path $root "tools\jdk\bin\jarsigner.exe"
$ks    = Join-Path $root "ai-dermatologist-release.keystore"
$alias = "aidermatologist"

$stem   = "DermaLens AI v1.1.8-vc124"
$unsAab = Join-Path $PSScriptRoot "$stem-unsigned.aab"
$outAab = Join-Path $root "$stem.aab"

$line = Get-Content (Join-Path $root "ai-dermatologist-release.keystore.txt") | Where-Object { $_ -match '^Password:\s*(\S+)' } | Select-Object -First 1
if (-not $line) { throw "Password line not found in keystore.txt" }
$null = $line -match '^Password:\s*(\S+)'
$env:KSPASS = $Matches[1]

try {
    Write-Host "== sign AAB" -ForegroundColor Cyan
    & $jars -keystore $ks -storepass:env KSPASS -sigalg SHA256withRSA -digestalg SHA-256 -signedjar $outAab $unsAab $alias
    if ($LASTEXITCODE -ne 0) { throw "jarsigner failed ($LASTEXITCODE)" }
    & $jars -verify $outAab | Select-Object -First 2

    Write-Host "== bundletool validate AAB" -ForegroundColor Cyan
    & $java -jar (Join-Path $root "tools\bundletool.jar") validate --bundle=$outAab | Select-Object -First 3
    if ($LASTEXITCODE -ne 0) { throw "bundletool validate failed ($LASTEXITCODE)" }

    Write-Host "`nDone:`n  $outAab" -ForegroundColor Green
}
finally {
    Remove-Item Env:\KSPASS -ErrorAction SilentlyContinue
}
