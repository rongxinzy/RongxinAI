param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedThumbprint,

  # Packaged executable base name without extension. Defaults to the
  # executableName from the project electron-builder.json; enterprise overlay
  # builds pass their own product executable name instead.
  [Parameter(Mandatory = $false)]
  [string]$ExecutableName = ''
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

$appExecutableName = $ExecutableName
if (-not $appExecutableName) {
  $builderConfig = Get-Content -LiteralPath (
    Join-Path $ProjectRoot 'electron-builder.json'
  ) -Raw -Encoding UTF8 | ConvertFrom-Json
  $appExecutableName = $builderConfig.executableName
}
if (-not $appExecutableName) {
  throw 'Packaged executable name is empty; pass -ExecutableName or define executableName in electron-builder.json.'
}
$appExecutable = Join-Path $ProjectRoot (
  "release\win-unpacked\$appExecutableName.exe"
)
$installers = @(
  Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') `
    -Filter '*.exe' -File
)
$targets = @($appExecutable)
if ($ExecutableName) {
  # The enterprise overlay retains its independent NSIS-only distribution.
  if ($installers.Count -ne 1) { throw 'Expected exactly one enterprise installer.' }
  $targets += $installers[0].FullName
} else {
  $version = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $shellName = "ZhiYuanAgent-Setup-$version.exe"
  $shell = @($installers | Where-Object { $_.Name -eq $shellName })
  $updater = @($installers | Where-Object { $_.Name -ne $shellName })
  if ($installers.Count -ne 2 -or $shell.Count -ne 1 -or $updater.Count -ne 1) {
    throw 'Expected one WebView2 installer and one NSIS updater.'
  }
  $targets += @($shell[0].FullName, $updater[0].FullName,
    (Join-Path $ProjectRoot 'scripts\installer-shell\out\ZhiYuanUninstall.exe'))
}
$magpieDirectory = Join-Path $ProjectRoot 'release\win-unpacked\resources\magpie\win32-x64'
$magpieExecutable = Join-Path $magpieDirectory 'magpie.exe'
$targets += $magpieExecutable
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

$magpieManifest = Get-Content -LiteralPath (Join-Path $magpieDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$magpieDigest = (Get-FileHash -LiteralPath $magpieExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($magpieManifest.sha256 -ne $magpieDigest) {
  throw "Magpie SHA-256 does not match the sealed manifest: $magpieExecutable"
}
if ($magpieManifest.buildSha256 -eq $magpieManifest.sha256) {
  throw 'Signed Magpie must keep the compiler digest distinct from the shipped digest.'
}
if ($magpieManifest.signing.platform -ne 'win32' -or $magpieManifest.signing.format -ne 'authenticode') {
  throw 'Signed Magpie manifest is missing the Authenticode seal.'
}
$magpieUpstream = Get-Content -LiteralPath (Join-Path $ProjectRoot 'resources\magpie\upstream.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($magpieManifest.version -ne $magpieUpstream.version -or $magpieManifest.source.commit -ne $magpieUpstream.commit) {
  throw 'Packaged Magpie does not match the pinned upstream release.'
}

Write-Output 'Windows application, installer, updater, uninstall host, and Magpie Authenticode signatures are valid.'
