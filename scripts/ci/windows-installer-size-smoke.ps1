param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  # CAD expert runtime dependencies add a bounded shared Python layer to the
  # installer. Keep explicit headroom for that payload while retaining the
  # independent non-component ceiling below.
  [int64]$MaximumInstallerBytes = 450MB,
  [int64]$MaximumComponentBytes = 300MB,
  [int64]$MaximumNonComponentBytes = 150MB,
  # WebView2 adds one self-contained .NET host. Keep the legacy NSIS limits
  # unchanged and bound that separately measured overhead by artifact kind.
  [int64]$MaximumShellBytes = 500MB,
  [int64]$MaximumShellNonComponentBytes = 220MB
)

$ErrorActionPreference = 'Stop'

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

$installer = $installers[0]
$installerBytes = [int64]$installer.Length
$nonComponentBytes = $installerBytes - $componentBytes
if ($componentBytes -gt $MaximumComponentBytes) {
  throw "Windows component archives are unexpectedly large: $componentBytes bytes (maximum $MaximumComponentBytes bytes)"
}
if ($nonComponentBytes -gt $MaximumNonComponentBytes) {
  throw "Windows installer non-component payload is unexpectedly large: $nonComponentBytes bytes (maximum $MaximumNonComponentBytes bytes)"
}
if ($installerBytes -gt $MaximumInstallerBytes) {
  throw "Windows installer is unexpectedly large: $installerBytes bytes (maximum $MaximumInstallerBytes bytes; component archive bytes $componentBytes)"
}

$shells = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter 'ZhiYuanAgent-Setup-*.exe' -File)
if ($shells.Count -gt 1) { throw 'Expected at most one WebView2 installer' }
$shellSummary = @()
if ($shells.Count -eq 1) {
  $shellBytes = [int64]$shells[0].Length
  $shellNonComponentBytes = $shellBytes - $componentBytes
  if ($shellBytes -gt $MaximumShellBytes -or $shellNonComponentBytes -gt $MaximumShellNonComponentBytes) {
    throw "WebView2 installer exceeds its kind-specific budget: total=$shellBytes (maximum $MaximumShellBytes), non-component=$shellNonComponentBytes (maximum $MaximumShellNonComponentBytes)"
  }
  $shellSummary = @(
    "- WebView2 installer bytes (including final signature): $shellBytes",
    "- WebView2 non-component bytes: $shellNonComponentBytes",
    "- WebView2 total ceiling: $MaximumShellBytes",
    "- WebView2 non-component ceiling: $MaximumShellNonComponentBytes"
  )
}

$componentSummary = @($manifest.components | ForEach-Object {
  "- component ``$($_.key)``: $([int64]$_.archiveSizeBytes) bytes ($($_.archiveCompression))"
})
$summary = @(
  '### Windows installer size',
  '',
  "- installer: ``$($installer.Name)``",
  "- installer bytes: $installerBytes",
  "- component archive bytes: $componentBytes",
  "- non-component bytes: $nonComponentBytes",
  "- installer ceiling: $MaximumInstallerBytes",
  "- component ceiling: $MaximumComponentBytes",
  "- non-component ceiling: $MaximumNonComponentBytes",
  ''
) + $componentSummary + $shellSummary
$summary = $summary -join [Environment]::NewLine
Write-Host $summary
if ($env:GITHUB_STEP_SUMMARY) {
  Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary -Encoding UTF8
}
