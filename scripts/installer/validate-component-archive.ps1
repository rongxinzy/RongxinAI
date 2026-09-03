param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$SevenZipPath,
  [Parameter(Mandatory = $true)][string]$Prefix,
  [Parameter(Mandatory = $false)][string]$ExpectedHash = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "Component archive is missing: $ArchivePath"
}
if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
  throw "7za executable is missing: $SevenZipPath"
}

if ($ExpectedHash) {
  $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedHash.ToLowerInvariant()) {
    Write-Output "hash-mismatch"
    exit 2
  }
}

$normalizedPrefix = $Prefix.Replace('\', '/').Trim('/')
if (-not $normalizedPrefix -or $normalizedPrefix -match '(^|/)\.\.(/|$)' -or $normalizedPrefix -match ':') {
  throw "Unsafe component prefix: $Prefix"
}

$lines = @(& $SevenZipPath l -slt $ArchivePath)
if ($LASTEXITCODE -ne 0) {
  throw "7za list failed with exit code $LASTEXITCODE"
}

$paths = @(
  $lines |
    Where-Object { $_ -match '^Path = ' } |
    ForEach-Object { $_.Substring(7) }
)
if ($paths.Count -lt 2) {
  throw 'Archive has no entries'
}

foreach ($entry in @($paths | Select-Object -Skip 1)) {
  $normalizedEntry = $entry.Replace('\', '/')
  if (
    [string]::IsNullOrWhiteSpace($normalizedEntry) -or
    $normalizedEntry -match '^(?:[A-Za-z]:|/)' -or
    $normalizedEntry -match '(^|/)\.\.(/|$)' -or
    $normalizedEntry -match ':'
  ) {
    throw "Unsafe archive entry: $entry"
  }

  $isExpectedEntry =
    $normalizedEntry.Equals($normalizedPrefix, [System.StringComparison]::Ordinal) -or
    $normalizedEntry.StartsWith("$normalizedPrefix/", [System.StringComparison]::Ordinal)
  if (-not $isExpectedEntry) {
    throw "Unexpected archive entry: $entry"
  }
}

$unsafeLinkMetadata = @(
  $lines | Where-Object {
    if ($_ -notmatch '^(Symbolic Link|Hard Link|Reparse Point) = (.*)$') {
      return $false
    }
    $value = $Matches[2].Trim()
    return $value -and $value -ne '-'
  }
)
if ($unsafeLinkMetadata.Count -gt 0) {
  throw "Archive contains link metadata: $($unsafeLinkMetadata[0])"
}

Write-Output 'Component archive validation passed'
