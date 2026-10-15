# Shared component-activation step (junction switching with the
# component-switch-state.txt rollback protocol). The current component set is
# checked against the bundled routing metadata before any junction is changed.
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

# Windows PowerShell 5.1 resolves New-Item -Target as a wildcard path. Use
# the OS junction command with literal paths in a child-only environment.
# The fixed command contains no caller-provided text; delayed expansion and
# AutoRun are disabled so [], %, !, &, spaces and parentheses stay path data.
function New-LiteralDirectoryJunction {
  param([string]$LinkPath, [string]$TargetPath)
  if ($LinkPath -match '["\r\n]' -or $TargetPath -match '["\r\n]') {
    throw 'Invalid character in junction path'
  }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path ([Environment]::SystemDirectory) 'cmd.exe'
  $start.Arguments = '/d /v:off /c mklink /J "%ZY_JUNCTION_LINK%" "%ZY_JUNCTION_TARGET%"'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables['ZY_JUNCTION_LINK'] = [IO.Path]::GetFullPath($LinkPath)
  $start.EnvironmentVariables['ZY_JUNCTION_TARGET'] = [IO.Path]::GetFullPath($TargetPath)
  $process = [Diagnostics.Process]::Start($start)
  if ($null -eq $process) { throw 'Unable to start Windows junction creation' }
  try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) {
      $process.Kill()
      $process.WaitForExit()
      throw "Junction creation timed out: $LinkPath"
    }
    $output = $stdout.GetAwaiter().GetResult()
    $errorOutput = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
      throw "Junction creation failed ($($process.ExitCode)): $LinkPath -> $TargetPath. $errorOutput $output"
    }
  } finally { $process.Dispose() }
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$targets = @((Get-Content -LiteralPath $TargetsPath -Raw -ErrorAction Stop | ConvertFrom-Json))
$expectedKeys = @('channel-runtime', 'mcps', 'portable-git', 'python', 'skill-python', 'skills', 'uv')
$targetKeys = @($targets | ForEach-Object { [string]$_.key } | Sort-Object)
$manifestKeys = @($manifest.components | ForEach-Object { [string]$_.key } | Sort-Object)
if ($targets.Count -ne $expectedKeys.Count -or ($targetKeys -join ',') -cne ($expectedKeys -join ',') -or
    @($manifest.components).Count -ne $expectedKeys.Count -or ($manifestKeys -join ',') -cne ($expectedKeys -join ',')) {
  throw 'Invalid component manifest: expected the complete application component set (no missing, duplicate or unknown components)'
}
$rows = @($targets | ForEach-Object {
  $targetRow = $_
  if ($targetRow.key -notmatch '^[a-z0-9-]+\z' -or $targetRow.prefix -notmatch '^[A-Za-z0-9-]+\z') { throw 'Invalid component target entry' }
  $idPath = Join-Path $PluginDir ('component-' + $targetRow.key + '.version')
  $id = (Get-Content -LiteralPath $idPath -Raw -ErrorAction Stop).Trim()
  if ($id -notmatch '^[0-9a-f]{64}\z') { throw 'Invalid component content ID for ' + $targetRow.key }
  $manifestEntry = @($manifest.components | Where-Object { $_.key -eq $targetRow.key })
  if ($manifestEntry.Count -ne 1 -or $manifestEntry[0].prefix -cne $targetRow.prefix -or $manifestEntry[0].contentId -cne $id) { throw "Component manifest mismatch: $($targetRow.key)" }
  [pscustomobject]@{ Key = [string]$targetRow.key; Prefix = [string]$targetRow.prefix; Id = $id }
})
$prepared = @()
$switched = @()
try {
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
    New-LiteralDirectoryJunction -LinkPath $next -TargetPath $target
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
