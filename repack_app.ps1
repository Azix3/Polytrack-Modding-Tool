param(
    [string]$SourceDir = "C:\Users\aroon\Documents\PolyTrack_decompiled_20260317",
    [string]$GameDir = "C:\Users\aroon\Documents\PolyTrack",
    [string]$OutputAsarPath
)

if (-not (Test-Path $SourceDir)) {
    throw "Could not find source directory: $SourceDir"
}

$resourcesDir = Join-Path $GameDir "resources"
if (-not (Test-Path $resourcesDir)) {
    throw "Could not find resources directory: $resourcesDir"
}

if ([string]::IsNullOrWhiteSpace($OutputAsarPath)) {
    $OutputAsarPath = Join-Path $resourcesDir "app.asar"
}

$backupPath = "$OutputAsarPath.original"
if ((Test-Path $OutputAsarPath) -and -not (Test-Path $backupPath)) {
    Copy-Item -Path $OutputAsarPath -Destination $backupPath
    Write-Host "Backed up original ASAR to $backupPath"
}

npx -y @electron/asar pack $SourceDir $OutputAsarPath
if ($LASTEXITCODE -ne 0) {
    throw "ASAR packing failed"
}

Write-Host "Packed $SourceDir -> $OutputAsarPath"
