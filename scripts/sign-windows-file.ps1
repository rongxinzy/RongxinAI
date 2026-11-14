param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$TargetOS = 'windows',
  [string]$ExpectedThumbprint = $env:CERTUM_CERT_THUMBPRINT
)

$ErrorActionPreference = 'Stop'
if ($TargetOS -ne 'windows') { return }
# Windows PowerShell 5.1 started from pwsh inherits PowerShell 7's PSModulePath
# and then cannot autoload its own security module (no Cert: drive). Load the
# module that ships with this host.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$thumbprint = ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
  throw 'The Certum signing certificate SHA-1 thumbprint must be configured.'
}
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "Windows runtime to sign was not found: $Path"
}
# Read the store through .NET so lookup does not depend on the Cert: provider.
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  $certificates = @(
    $store.Certificates |
      Where-Object { $_.Thumbprint.ToUpperInvariant() -eq $thumbprint }
  )
} finally {
  $store.Close()
}
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
