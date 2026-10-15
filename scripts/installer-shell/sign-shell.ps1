param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$ExpectedThumbprint = $env:CERTUM_CERT_THUMBPRINT
)

$ErrorActionPreference = 'Stop'
# Reuse the protected SimplySign certificate and the repository's existing
# SHA-256 / RFC3161 Certum signing implementation. No new credentials or store.
& (Join-Path $PSScriptRoot '..\runtime-signing\sign-runtime.ps1') `
  -Path $Path -ExpectedThumbprint $ExpectedThumbprint
if ($LASTEXITCODE -ne 0) { throw 'Certum shell signing failed.' }
$thumbprint = ($ExpectedThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
$certificate = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumbprint })
if ($certificate.Count -ne 1) { throw 'The configured Certum certificate is unavailable.' }
$signature = Get-AuthenticodeSignature -FilePath $Path
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
    $null -eq $signature.TimeStamperCertificate -or
    [Convert]::ToBase64String($signature.SignerCertificate.RawData) -ne
      [Convert]::ToBase64String($certificate[0].RawData)) {
  throw "The signed shell must have a valid, timestamped signature from the configured Certum certificate: $Path"
}
