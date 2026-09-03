param(
  [Parameter(Mandatory = $true)][ValidateSet('cache', 'expand')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$PluginDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ComponentTargetsPath,
  [Parameter(Mandatory = $true)][string]$SevenZipPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Stop-WithCode([int]$Code, [string]$Message) {
  Write-Output $Message
  exit $Code
}

function Read-ExpectedHash([string]$Path, [string]$Description) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing ${Description}: ${Path}"
  }
  $value = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim().ToLowerInvariant()
  if ($value -notmatch '^[0-9a-f]{64}$') {
    throw "Invalid ${Description}: ${Path}"
  }
  return $value
}

function Test-SafeRelativePath([string]$Value, [string]$Description) {
  $normalized = $Value.Replace('\', '/')
  if (
    [string]::IsNullOrWhiteSpace($normalized) -or
    $normalized -match '^(?:[A-Za-z]:|/)' -or
    $normalized -match '(^|/)\.\.(/|$)' -or
    $normalized -match ':'
  ) {
    throw "Invalid ${Description}: ${Value}"
  }
  return $normalized
}

function Get-Components {
  if (-not (Test-Path -LiteralPath $ComponentTargetsPath -PathType Leaf)) {
    throw "Component targets are missing: $ComponentTargetsPath"
  }
  $targets = @((Get-Content -LiteralPath $ComponentTargetsPath -Raw -ErrorAction Stop | ConvertFrom-Json))
  if ($targets.Count -ne 7) {
    throw "Invalid component targets: expected 7 components, got $($targets.Count)"
  }

  $components = @(
    foreach ($target in $targets) {
      $key = [string]$target.key
      $prefix = [string]$target.prefix
      $sentinel = [string]$target.sentinel
      if ($key -notmatch '^[a-z0-9-]+$') {
        throw "Invalid component key: $key"
      }
      Test-SafeRelativePath $prefix 'component prefix' | Out-Null
      Test-SafeRelativePath $sentinel 'component sentinel' | Out-Null

      $id = Read-ExpectedHash (Join-Path $PluginDir "component-$key.version") "component content ID for $key"
      $archiveHash = Read-ExpectedHash (Join-Path $PluginDir "component-$key.sha256") "component archive SHA-256 for $key"
      $sentinelHash = Read-ExpectedHash (Join-Path $PluginDir "component-$key.sentinel-sha256") "component sentinel SHA-256 for $key"
      [pscustomobject]@{
        Key = $key
        Prefix = $prefix
        Sentinel = $sentinel
        Id = $id
        ArchiveHash = $archiveHash
        SentinelHash = $sentinelHash
      }
    }
  )
  if (@($components.Key | Sort-Object -Unique).Count -ne 7) {
    throw 'Invalid component targets: duplicate component key'
  }
  return $components
}

function Test-ArchiveEntries([string]$ArchivePath, [string]$Prefix) {
  $normalizedPrefix = Test-SafeRelativePath $Prefix 'component prefix'
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
    $normalizedEntry = Test-SafeRelativePath $entry 'archive entry'
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
}

try {
  if (-not (Test-Path -LiteralPath $PluginDir -PathType Container)) {
    throw "Plugin directory is missing: $PluginDir"
  }
  if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
    throw "7za executable is missing: $SevenZipPath"
  }
  $components = Get-Components

  if ($Mode -eq 'cache') {
    foreach ($component in $components) {
      $marker = Join-Path $PluginDir "component-$($component.Key).cache-valid"
      Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
      $target = Join-Path (Join-Path $RuntimeRoot $component.Key) $component.Id
      $complete = Join-Path $target '.complete'
      $sentinel = Join-Path $target $component.Sentinel
      try {
        if (-not (Test-Path -LiteralPath $complete -PathType Leaf)) { continue }
        $completeId = (Get-Content -LiteralPath $complete -Raw -ErrorAction Stop).Substring(0, 64).ToLowerInvariant()
        if ($completeId -ne $component.Id -or -not (Test-Path -LiteralPath $sentinel -PathType Leaf)) { continue }
        $actualHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        if ($actualHash -ne $component.SentinelHash) { continue }
        New-Item -ItemType File -Path $marker -Force | Out-Null
        Write-Output "cache-hit:$($component.Key)"
      } catch {
        Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
      }
    }
    exit 0
  }

  foreach ($component in $components) {
    $marker = Join-Path $PluginDir "component-$($component.Key).cache-valid"
    if (Test-Path -LiteralPath $marker -PathType Leaf) { continue }

    $archivePath = Join-Path $PluginDir "component-$($component.Key).7z"
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
      Stop-WithCode 1 "Missing component archive: $($component.Key)"
    }
    $actualArchiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualArchiveHash -ne $component.ArchiveHash) {
      Stop-WithCode 2 "hash-mismatch:$($component.Key)"
    }
    try {
      Test-ArchiveEntries $archivePath $component.Prefix
    } catch {
      Stop-WithCode 3 "unsafe-archive:$($component.Key):$($_.Exception.Message)"
    }

    $target = Join-Path (Join-Path $RuntimeRoot $component.Key) $component.Id
    $installing = "$target.installing"
    try {
      Remove-Item -LiteralPath $installing -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Path $installing -Force | Out-Null
      & $SevenZipPath x -bd -y "-o$installing" $archivePath | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Stop-WithCode 4 "extract-failed:$($component.Key):$LASTEXITCODE"
      }
      $sentinel = Join-Path $installing $component.Sentinel
      if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
        Stop-WithCode 5 "sentinel-missing:$($component.Key)"
      }
      $actualSentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualSentinelHash -ne $component.SentinelHash) {
        Stop-WithCode 5 "sentinel-mismatch:$($component.Key)"
      }
      Set-Content -LiteralPath (Join-Path $installing '.complete') -Value "$($component.Id)|$($component.ArchiveHash)" -NoNewline
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $installing -Destination $target -ErrorAction Stop
      Write-Output "expanded:$($component.Key)"
    } catch {
      Stop-WithCode 4 "extract-failed:$($component.Key):$($_.Exception.Message)"
    } finally {
      Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  Stop-WithCode 1 $_.Exception.Message
}
