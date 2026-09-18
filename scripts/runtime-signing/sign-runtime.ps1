param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$TargetOS = 'windows',
  [string]$ExpectedThumbprint = $env:CERTUM_CERT_THUMBPRINT
)

$ErrorActionPreference = 'Stop'
if ($TargetOS -ne 'windows') { return }
. (Join-Path $PSScriptRoot 'runtime-authenticode.ps1')
$thumbprint = Assert-RuntimeSignerThumbprint $ExpectedThumbprint
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "Windows runtime to sign was not found: $Path"
}
$certificates = @(
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Thumbprint.ToUpperInvariant() -eq $thumbprint }
)
if ($certificates.Count -ne 1 -or -not $certificates[0].HasPrivateKey) {
  throw 'The configured Certum certificate and cloud private key must be available.'
}
if ($certificates[0].NotAfter -le [DateTime]::UtcNow) {
  throw 'The configured Certum certificate has expired.'
}
$signTool = Get-ChildItem -Path `
  "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
if (-not $signTool) { throw 'Microsoft SignTool was not found.' }
& $signTool sign /v /fd sha256 /sha1 $thumbprint `
  /tr http://time.certum.pl /td sha256 $Path
if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE." }
& $signTool verify /pa /all /v $Path
if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed with exit code $LASTEXITCODE." }
Assert-WindowsRuntimeSignature -Path $Path -ExpectedThumbprint $thumbprint
