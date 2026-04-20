# Regenerates ipl-fantasy-ui-preview.html from public data + preview fragments.
# Run from repo root: powershell -ExecutionPolicy Bypass -File scripts/merge-ui-preview.ps1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$data = Join-Path $root "public\IPL-Fantasy-Phase-2\data"
$meta = Get-Content "$data\meta.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$fr = Get-Content "$data\franchises.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$pl = Get-Content "$data\players.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$auction = Get-Content "$data\auction.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$rules = Get-Content "$data\rules.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$predictions = Get-Content "$data\predictions.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$bundle = [ordered]@{
  meta        = $meta
  franchises  = $fr.franchises
  players     = $pl.players
  auction     = $auction
  rules       = $rules
  predictions = $predictions
}
$json = $bundle | ConvertTo-Json -Depth 20 -Compress
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $root "preview-embed.json"), $json, $utf8)

$h = [System.IO.File]::ReadAllText((Join-Path $root "preview-head.html"))
$a = [System.IO.File]::ReadAllText((Join-Path $root "preview-app.js"))
$full = $h + '<script type="application/json" id="league-json">' + $json + '</script>' + "`n" + '<script>' + "`n" + $a + "`n" + '</script>' + "`n" + '</body>' + "`n" + '</html>'
[System.IO.File]::WriteAllText((Join-Path $root "ipl-fantasy-ui-preview.html"), $full, $utf8)
Write-Host "Wrote ipl-fantasy-ui-preview.html"
