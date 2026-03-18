$ErrorActionPreference = "Stop"

$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gameDir = "C:\Users\aroon\Documents\PolyTrack"
$releaseDir = Join-Path $toolsDir "release_package"
$releaseResourcesDir = Join-Path $releaseDir "resources"
$releaseModsDir = Join-Path $releaseDir "mods"
$releaseZipPath = Join-Path $toolsDir "release_package.zip"

if (-not (Test-Path (Join-Path $gameDir "resources\app.asar"))) {
    throw "Expected modded app.asar at $gameDir\resources\app.asar"
}

if (-not (Test-Path (Join-Path $gameDir "mods"))) {
    throw "Expected mods folder at $gameDir\mods"
}

if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}

if (Test-Path $releaseZipPath) {
    Remove-Item -Force $releaseZipPath
}

New-Item -ItemType Directory -Path $releaseResourcesDir | Out-Null
New-Item -ItemType Directory -Path $releaseModsDir | Out-Null

Copy-Item (Join-Path $gameDir "resources\app.asar") (Join-Path $releaseResourcesDir "app.asar")
Copy-Item (Join-Path $gameDir "mods\*") $releaseModsDir -Recurse
Copy-Item (Join-Path $toolsDir "README_INSTALL.txt") (Join-Path $releaseDir "README_INSTALL.txt")

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $releaseZipPath

Write-Host "Built release package at $releaseDir"
Write-Host "Built release zip at $releaseZipPath"
