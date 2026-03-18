param(
    [string]$SourceDir = "C:\Users\aroon\Documents\PolyTrack_decompiled_20260317"
)

$mainJsPath = Join-Path $SourceDir "electron\main.js"
if (-not (Test-Path $mainJsPath)) {
    throw "Could not find $mainJsPath"
}

$content = Get-Content -Raw -Path $mainJsPath
if ($content -match 'devTools:!0') {
    Write-Host "DevTools are already enabled in $mainJsPath"
    exit 0
}

$updated = $content -replace 'devTools:!1', 'devTools:!0'
if ($updated -eq $content) {
    throw "Could not find the devTools flag in $mainJsPath"
}

Set-Content -Path $mainJsPath -Value $updated -NoNewline
Write-Host "Enabled DevTools in $mainJsPath"
