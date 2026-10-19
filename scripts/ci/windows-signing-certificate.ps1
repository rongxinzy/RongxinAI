function Resolve-WindowsSigningCertificate {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedThumbprint,
    [string]$CertificatePath = ''
  )
  $thumbprint = ($ExpectedThumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
  if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
    throw 'ExpectedThumbprint must contain a 40-character SHA-1 thumbprint.'
  }
  if ($CertificatePath) {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
      [IO.Path]::GetFullPath($CertificatePath)
    )
    if ($certificate.HasPrivateKey) { throw 'Acceptance certificate must contain only public data.' }
  } else {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $certificates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {
      $_.Thumbprint -ceq $thumbprint
    })
    if ($certificates.Count -ne 1) {
      throw "Expected exactly one configured Certum certificate; found $($certificates.Count)."
    }
    $certificate = $certificates[0]
  }
  if ($certificate.Thumbprint -cne $thumbprint) {
    throw 'Acceptance certificate does not match the configured thumbprint.'
  }
  return $certificate
}
