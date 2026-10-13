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

# Background recursive delete of detached previous installs, same intent as
# the original async NSIS span (slow disks must not block setup). Enumerate
# in PowerShell and hand the targets to a detached child via an encoded
# command + inherited environment variable, so no path characters (cmd
# metacharacters like "&" are legal in directory names) can inject into a
# command line.
$targets = @(Get-ChildItem -Path "$InstallDir.old*" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
if ($targets.Count -gt 0) {
  $env:ZY_CLEANUP_TARGETS = $targets -join "`n"
  $cleanupScript = '$t = $env:ZY_CLEANUP_TARGETS -split "`n"; foreach ($p in $t) { if ($p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue } }'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupScript))
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded | Out-Null
}

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
