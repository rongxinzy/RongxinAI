param(
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..')) }

$installers = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter '*.exe' -File |
  Where-Object { $_.Name -notlike '*Uninstall*' -and $_.Name -notlike 'ZhiYuanAgent-Setup-*' })
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows installer; found $($installers.Count)"
}

$manifestPath = Join-Path $ProjectRoot 'build-tar\windows-components\manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing Windows component manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$componentBytes = @($manifest.components | ForEach-Object { [int64]$_.archiveSizeBytes } |
  Measure-Object -Sum).Sum
if ($null -eq $componentBytes -or $componentBytes -le 0) {
  throw 'Windows component manifest did not report component archive bytes'
}

# Size is telemetry only. Hash/manifest integrity is checked by the build
# and runtime acceptance, independent of these measurements.
$edition = if ($env:ZHIYUAN_UPDATE_VARIANT) { $env:ZHIYUAN_UPDATE_VARIANT.Trim().ToLowerInvariant() } else { 'lite' }
$nsisComponentBytes = $componentBytes
$uncapped = $true

$installer = $installers[0]
$installerBytes = [int64]$installer.Length
$nonComponentBytes = $installerBytes - $nsisComponentBytes
Write-Host ("[measure] windows-nsis-updater edition={0} uncapped={1} installerBytes={2} componentArchiveBytes={3} nonComponentBytes={4}" -f $edition, $uncapped, $installerBytes, $nsisComponentBytes, $nonComponentBytes)
$shells = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter 'ZhiYuanAgent-Setup-*.exe' -File)
if ($shells.Count -gt 1) { throw 'Expected at most one WebView2 installer' }
$shellSummary = @()
if ($shells.Count -eq 1) {
  $shellBytes = [int64]$shells[0].Length
  $shellNonComponentBytes = $shellBytes - $componentBytes
  Write-Host ("[measure] windows-webview2-setup edition={0} uncapped={1} installerBytes={2} componentArchiveBytes={3} nonComponentBytes={4}" -f $edition, $uncapped, $shellBytes, $componentBytes, $shellNonComponentBytes)
  $shellSummary = @(
    "- WebView2 installer bytes (including final signature): $shellBytes",
    "- WebView2 non-component bytes: $shellNonComponentBytes"
  )
}

$componentSummary = @($manifest.components | ForEach-Object {
  Write-Host ("[measure] windows-component edition={0} key={1} archiveSizeBytes={2}" -f $edition, $_.key, [int64]$_.archiveSizeBytes)
  "- component ``$($_.key)``: $([int64]$_.archiveSizeBytes) bytes ($($_.archiveCompression))"
})
$ceilingNote = if ($uncapped) { "- edition ``$edition``: UNCAPPED (measured, no size limit by decision)" } else { "- edition ``$edition``: enforced limits" }
$summary = @(
  '### Windows installer size',
  '',
  $ceilingNote,
  "- component count: $(@($manifest.components).Count)",
  "- installer: ``$($installer.Name)``",
  "- installer bytes: $installerBytes",
  "- component archive bytes: $componentBytes",
  "- non-component bytes: $nonComponentBytes",
  ''
) + $componentSummary + $shellSummary
$summary = $summary -join [Environment]::NewLine
Write-Host $summary
if ($env:GITHUB_STEP_SUMMARY) {
  Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary -Encoding UTF8
}
