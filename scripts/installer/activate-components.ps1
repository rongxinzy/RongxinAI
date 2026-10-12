# Shared component-activation step (junction switching with the
# component-switch-state.txt rollback protocol). Verbatim extraction of the
# inline PowerShell that used to live in scripts/nsis-installer.nsh
# ("Activating offline components"); behavior is intentionally unchanged.
# Both the NSIS installer and the WebView2 shell orchestrate via this script.
#
# Exit codes: 0 on success; non-zero on failure with the error detail on the
# error stream (NSIS nsExec surfaces it the same way it did for the inline
# command, which also wrote nothing to stdout).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PluginDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$TargetsPath,
  [Parameter(Mandatory = $true)][string]$StatePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$targets = @((Get-Content -LiteralPath $TargetsPath -Raw -ErrorAction Stop | ConvertFrom-Json))
$rows = @($targets | ForEach-Object {
  $targetRow = $_
  if ($targetRow.key -notmatch '^[a-z0-9-]+\z' -or $targetRow.prefix -notmatch '^[A-Za-z0-9-]+\z') { throw 'Invalid component target entry' }
  $idPath = Join-Path $PluginDir ('component-' + $targetRow.key + '.version')
  $id = (Get-Content -LiteralPath $idPath -Raw -ErrorAction Stop).Trim()
  if ($id -notmatch '^[0-9a-f]{64}\z') { throw 'Invalid component content ID for ' + $targetRow.key }
  $manifestEntry = @($manifest.components | Where-Object { $_.key -eq $targetRow.key })
  if ($manifestEntry.Count -ne 1 -or $manifestEntry[0].prefix -ne $targetRow.prefix -or $manifestEntry[0].contentId -ne $id) { throw "Component manifest mismatch: $($targetRow.key)" }
  [pscustomobject]@{ Key = [string]$targetRow.key; Prefix = [string]$targetRow.prefix; Id = $id }
})
$prepared = @()
$switched = @()
try {
  if ($rows.Count -ne 7) { throw "Invalid component manifest: expected 7 components, got $($rows.Count)" }
  if (@($rows.Key | Sort-Object -Unique).Count -ne 7) { throw 'Invalid component manifest: duplicate component key' }
  foreach ($row in $rows) {
    $root = Join-Path $RuntimeRoot $row.Key
    $target = Join-Path $root $row.Id
    $complete = Join-Path $target '.complete'
    if (-not (Test-Path -LiteralPath $target) -or -not (Test-Path -LiteralPath $complete)) { throw "Missing prepared component target: $target" }
    $completeId = (Get-Content -LiteralPath $complete -Raw).Substring(0, 64)
    if ($completeId -ne $row.Id) { throw "Prepared component id mismatch: $($row.Key)" }
    $current = Join-Path $root 'current'
    $next = Join-Path $root 'current.next'
    $previous = Join-Path $root 'current.previous'
    if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $current)) { Rename-Item -LiteralPath $previous -NewName 'current' -ErrorAction Stop }
    foreach ($stale in @($next, $previous)) {
      if (Test-Path -LiteralPath $stale) {
        $item = Get-Item -LiteralPath $stale -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw "Unsafe component pointer: $stale" }
        [IO.Directory]::Delete($stale)
      }
    }
    New-Item -ItemType Junction -Path $next -Target $target -Force -ErrorAction Stop | Out-Null
    if (-not (Test-Path -LiteralPath $next)) { throw "Failed to prepare component junction: $next" }
    $prepared += [pscustomobject]@{ Row = $row; Current = $current; Next = $next; Previous = $previous }
  }
  foreach ($entry in $prepared) {
    $hadCurrent = Test-Path -LiteralPath $entry.Current
    Add-Content -LiteralPath $StatePath -Value ($entry.Row.Key + '|' + $hadCurrent)
    $switched += [pscustomobject]@{ Entry = $entry; HadCurrent = $hadCurrent }
    if ($hadCurrent) { Rename-Item -LiteralPath $entry.Current -NewName 'current.previous' -ErrorAction Stop }
    Rename-Item -LiteralPath $entry.Next -NewName 'current' -ErrorAction Stop
  }
} catch {
  foreach ($entry in $prepared) {
    if (Test-Path -LiteralPath $entry.Next) { [IO.Directory]::Delete($entry.Next) }
  }
  [array]::Reverse($switched)
  foreach ($switch in $switched) {
    $entry = $switch.Entry
    if (Test-Path -LiteralPath $entry.Previous) {
      if (Test-Path -LiteralPath $entry.Current) { [IO.Directory]::Delete($entry.Current) }
      Rename-Item -LiteralPath $entry.Previous -NewName 'current'
    } elseif (-not $switch.HadCurrent -and (Test-Path -LiteralPath $entry.Current)) {
      [IO.Directory]::Delete($entry.Current)
    }
  }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  throw
}
