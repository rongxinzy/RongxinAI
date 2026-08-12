param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing ${Label}: $Path"
  }
}

function Invoke-Installer {
  param([Parameter(Mandatory = $true)][string]$Path, [string]$Label = 'installer')
  $process = Start-Process -FilePath $Path -ArgumentList @('/S') -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Label failed with exit code $($process.ExitCode)"
  }
}

$installers = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter '*.exe' -File |
  Where-Object { $_.Name -notlike '*Uninstall*' })
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows installer; found $($installers.Count)"
}

$installer = $installers[0].FullName
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\zhiyuan-agent'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'ZhiYuanAgent\runtimes'
$timingLog = Join-Path $env:APPDATA 'ZhiYuanAgent\install-timing.log'
$managedDefenderMarker = Join-Path $env:APPDATA 'ZhiYuanAgent\defender-exclusion-managed'
$componentKeys = @('channel-runtime', 'skills', 'mcps', 'portable-git', 'python', 'skill-python', 'uv')

try {
  Invoke-Installer $installer 'cold installation'
  Assert-Path (Join-Path $installRoot '知远.exe') 'installed application executable'
  Assert-Path $timingLog 'cold installation timing log'

  $coldLog = Get-Content -LiteralPath $timingLog -Raw -Encoding UTF8
  if (($coldLog | Select-String -AllMatches 'phase=component-cache-miss ').Matches.Count -ne 7) {
    throw 'Cold installation did not expand exactly seven offline components'
  }
  if ($coldLog -notmatch 'phase=install-complete .*component_set=ready') {
    throw 'Cold installation did not record a ready component set'
  }
  if ($coldLog -notmatch 'phase=defender-exclusion-skipped-silent') {
    throw 'CI silent installation unexpectedly entered the interactive Defender flow'
  }
  if (Test-Path -LiteralPath $managedDefenderMarker) {
    throw 'CI silent installation must not create a managed Defender exclusion marker'
  }

  foreach ($key in $componentKeys) {
    $current = Join-Path (Join-Path $runtimeRoot $key) 'current'
    Assert-Path $current "active component pointer $key"
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
      throw "Component pointer is not a junction: $current"
    }
  }

  Invoke-Installer $installer 'cache-hit upgrade'
  Assert-Path $timingLog 'upgrade timing log'
  $upgradeLog = Get-Content -LiteralPath $timingLog -Raw -Encoding UTF8
  if (($upgradeLog | Select-String -AllMatches 'phase=component-cache-hit ').Matches.Count -ne 7) {
    throw 'Repeated installation did not reuse exactly seven offline components'
  }
  if ($upgradeLog -match 'phase=component-cache-miss ') {
    throw 'Repeated installation unexpectedly expanded an offline component'
  }
  if ($upgradeLog -notmatch 'phase=install-complete .*component_set=ready') {
    throw 'Repeated installation did not record a ready component set'
  }

  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one uninstaller; found $($uninstallers.Count)"
  }
  Invoke-Installer $uninstallers[0].FullName 'uninstall'
  if (Test-Path -LiteralPath $runtimeRoot) {
    throw "Uninstall left the installer-managed runtime cache behind: $runtimeRoot"
  }
} finally {
  if (Test-Path -LiteralPath $installRoot) {
    $remainingUninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($remainingUninstallers.Count -eq 1) {
      Start-Process -FilePath $remainingUninstallers[0].FullName -ArgumentList @('/S') -Wait | Out-Null
    }
  }
}
