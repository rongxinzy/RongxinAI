# Shared post-install cleanup: previous-version directory teardown and
# unused component-version reclamation. Verbatim extraction of the two inline
# PowerShell/cmd spans that used to live in scripts/nsis-installer.nsh
# ("Scheduling previous version cleanup" + "Cleaning unused offline component
# versions", including the old-install-path marker deletion); behavior is
# intentionally unchanged. Both installers orchestrate via this script.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$OldInstallPathFile
)

# The original inline spans ran with PowerShell defaults (no Stop/StrictMode)
# and the NSIS caller ignored their exit codes; keep that forgiving shape.

# Remove known junctions explicitly before recursive deletion. This prevents
# an old installation cleanup from ever walking into an immutable shared pack.
$names = @('channel-runtime', 'SKILLs', 'MCPs', 'mingit', 'python-win', 'skill-python', 'uv-win')
Get-ChildItem -Path "$InstallDir.old*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $oldResources = Join-Path $_.FullName 'resources'
  foreach ($name in $names) {
    $link = Join-Path $oldResources $name
    if (Test-Path -LiteralPath $link) {
      $item = Get-Item -LiteralPath $link -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        [IO.Directory]::Delete($link)
      }
    }
  }
}

# Background recursive delete of detached previous installs, same command the
# NSIS installer spawned (async by design: slow disks must not block setup).
$deleteCommand = 'for /d %D in ("' + $InstallDir + '.old*") do @start "" /b cmd /c rd /s /q "%~fD"'
& "$env:COMSPEC" /c $deleteCommand | Out-Null

Remove-Item -LiteralPath $OldInstallPathFile -Force -ErrorAction SilentlyContinue

# Drop stale switch pointers and every non-current component version, then
# reclaim the legacy runtime-packs directory.
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$rows = @($manifest.components | ForEach-Object { [pscustomobject]@{ Key = [string]$_.key; Id = [string]$_.contentId } })
foreach ($row in $rows) {
  $root = Join-Path $RuntimeRoot $row.Key
  foreach ($pointerName in @('current.previous', 'current.next')) {
    $pointer = Join-Path $root $pointerName
    if (Test-Path -LiteralPath $pointer) {
      $item = Get-Item -LiteralPath $pointer -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($pointer) }
    }
  }
  Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $row.Id -and $_.Name -ne 'current' } | ForEach-Object {
    if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($_.FullName) } else { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
  }
}
$legacy = Join-Path (Split-Path $RuntimeRoot -Parent) 'runtime-packs'
if (Test-Path -LiteralPath $legacy) {
  $legacyItem = Get-Item -LiteralPath $legacy -Force
  if (($legacyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($legacy) } else { Remove-Item -LiteralPath $legacy -Recurse -Force }
}
