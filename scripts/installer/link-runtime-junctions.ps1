# Shared runtime-linking step (junctions under <install>\resources pointing
# into the content-addressed runtime cache). Verbatim extraction of the
# inline PowerShell that used to live in scripts/nsis-installer.nsh
# ("Connecting bundled runtimes"); behavior is intentionally unchanged.
# Both the NSIS installer and the WebView2 shell orchestrate via this script.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ResourceRoot,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ManifestPath
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
$rows = @($manifest.components | ForEach-Object { [pscustomobject]@{ Key = [string]$_.key; Prefix = [string]$_.prefix } })
foreach ($row in $rows) {
  $link = Join-Path $ResourceRoot $row.Prefix
  $target = Join-Path (Join-Path (Join-Path $RuntimeRoot $row.Key) 'current') $row.Prefix
  if (-not (Test-Path -LiteralPath $target)) { throw "Missing component target: $target" }
  if (Test-Path -LiteralPath $link) {
    $existing = Get-Item -LiteralPath $link -Force
    if (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      [IO.Directory]::Delete($link)
    } else {
      Remove-Item -LiteralPath $link -Recurse -Force
    }
  }
  New-LiteralDirectoryJunction -LinkPath $link -TargetPath $target
}
