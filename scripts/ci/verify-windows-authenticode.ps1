param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedThumbprint
)

$ErrorActionPreference = 'Stop'

$normalizedThumbprint = (
  $ExpectedThumbprint -replace '[^0-9A-Fa-f]', ''
).ToUpperInvariant()
if ($normalizedThumbprint -notmatch '^[0-9A-F]{40}$') {
  throw 'ExpectedThumbprint must contain a 40-character SHA-1 thumbprint.'
}

$expectedCertificates = @(
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object {
      ($_.Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant() -eq
        $normalizedThumbprint
    }
)
if ($expectedCertificates.Count -ne 1) {
  throw "Expected exactly one configured Certum certificate; found $($expectedCertificates.Count)."
}
$expectedCertificateDer = [Convert]::ToBase64String(
  $expectedCertificates[0].RawData
)

$builderConfig = Get-Content -LiteralPath (
  Join-Path $ProjectRoot 'electron-builder.json'
) -Raw -Encoding UTF8 | ConvertFrom-Json
$appExecutable = Join-Path $ProjectRoot (
  "release\win-unpacked\$($builderConfig.executableName).exe"
)
$installers = @(
  Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') `
    -Filter '*.exe' -File
)
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows installer; found $($installers.Count)."
}

$targets = @($appExecutable, $installers[0].FullName)
foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Signed Windows target was not found: $target"
  }

  $signature = Get-AuthenticodeSignature -FilePath $target
  if ($signature.Status -ne 'Valid') {
    throw "Authenticode status for $target is $($signature.Status), expected Valid."
  }

  $actualCertificateDer = [Convert]::ToBase64String(
    $signature.SignerCertificate.RawData
  )
  if ($actualCertificateDer -ne $expectedCertificateDer) {
    throw "Authenticode signer does not match the configured Certum certificate: $target"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode signature does not contain a trusted timestamp: $target"
  }
}

Write-Output 'Windows application and installer Authenticode signatures are valid.'
