param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$ResourcesRoot = '',
  [string]$ExpectedThumbprint = $env:RUNTIME_SIGNER_THUMBPRINT
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-authenticode.ps1')
$expected = Assert-RuntimeSignerThumbprint $ExpectedThumbprint
if ($ResourcesRoot) {
  $targets = @(
    (Join-Path $ResourcesRoot 'channel-runtime\cc-connect-sidecar.exe'),
    (Join-Path $ResourcesRoot 'memory\engram.exe')
  )
} else {
  $targets = @(
    (Join-Path $ProjectRoot 'vendor\channel-runtime\current\cc-connect-sidecar.exe'),
    (Join-Path $ProjectRoot 'vendor\engram-runtime\current\engram.exe')
  )
}
foreach ($target in $targets) {
  Assert-WindowsRuntimeSignature -Path $target -ExpectedThumbprint $expected
}
