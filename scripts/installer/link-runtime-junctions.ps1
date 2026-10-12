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

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$rows = @($manifest.components | ForEach-Object { [pscustomobject]@{ Key = [string]$_.key; Prefix = [string]$_.prefix } })
foreach ($row in $rows) {
  $link = Join-Path $ResourceRoot $row.Prefix
  $target = Join-Path (Join-Path (Join-Path $RuntimeRoot $row.Key) 'current') $row.Prefix
  if (-not (Test-Path -LiteralPath $target)) { throw "Missing component target: $target" }
  if (Test-Path $link) {
    $existing = Get-Item -LiteralPath $link -Force
    if (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      [IO.Directory]::Delete($link)
    } else {
      Remove-Item -LiteralPath $link -Recurse -Force
    }
  }
  New-Item -ItemType Junction -Path $link -Target $target -Force -ErrorAction Stop | Out-Null
}
