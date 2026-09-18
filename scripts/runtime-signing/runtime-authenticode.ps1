function Assert-RuntimeSignerThumbprint {
  param([string]$Thumbprint)
  $normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()
  if ($normalized -notmatch '^[0-9A-F]{40}$') {
    throw 'RUNTIME_SIGNER_THUMBPRINT must contain the expected public certificate SHA-1 thumbprint.'
  }
  return $normalized
}

function Assert-WindowsRuntimeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ExpectedThumbprint
  )
  $expected = Assert-RuntimeSignerThumbprint $ExpectedThumbprint
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Windows runtime was not found: $Path"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "Windows runtime signature is $($signature.Status), expected Valid: $Path"
  }
  if ($null -eq $signature.SignerCertificate -or
      $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expected) {
    throw "Windows runtime signer does not match the trusted certificate: $Path"
  }
  $codeSigning = @(
    $signature.SignerCertificate.Extensions |
      Where-Object { $_.Oid.Value -eq '2.5.29.37' } |
      ForEach-Object { $_.EnhancedKeyUsages } |
      Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' }
  )
  if ($codeSigning.Count -eq 0) {
    throw "Windows runtime signer does not permit code signing: $Path"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Windows runtime signature has no trusted timestamp: $Path"
  }
  Write-Output "Windows runtime signature and timestamp are valid: $Path"
}
