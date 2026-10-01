param(
  [Parameter(Mandatory = $true)][ValidateSet('cache', 'expand')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$PluginDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ComponentTargetsPath,
  [Parameter(Mandatory = $true)][string]$SevenZipPath,
  # Optional install-timing log; per-component phase records are appended so
  # the longest install spans stay observable on end-user machines.
  [string]$TimingLogPath = '',
  # Full count/byte tree audits are opt-in: the cheap path (completion record
  # plus sentinel hash) covers interrupted installs, and re-walking tens of
  # thousands of files on every upgrade costs minutes under real-time scanners.
  [switch]$DeepAudit
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Stop-WithCode([int]$Code, [string]$Message) {
  # NSIS relays stdout into a single-line dialog and log field, so exception
  # details must not span multiple lines.
  Write-Output ($Message -replace '[\r\n]+', ' ')
  exit $Code
}

function Add-Timing([string]$Line) {
  if (-not $TimingLogPath) { return }
  Add-Content -LiteralPath $TimingLogPath -Value $Line -ErrorAction SilentlyContinue
}

function Get-ElapsedMilliseconds([datetime]$StartedAt) {
  return [int64]((Get-Date) - $StartedAt).TotalMilliseconds
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

function ConvertTo-LongPath([string]$Path) {
  # Windows PowerShell 5.1 is not long-path aware, so .NET enumeration must be
  # handed an extended-length path to reach trees deeper than 260 characters.
  if ($Path.StartsWith('\\?\')) { return $Path }
  if ($Path.StartsWith('\\')) { return '\\?\UNC\' + $Path.Substring(2) }
  return '\\?\' + $Path
}

function Measure-ComponentTree([string]$Root) {
  # The completion record itself must stay out of the measurement: it is
  # written after the tree is measured during expand, but present on disk
  # during cache validation.
  $rootFull = (Get-Item -LiteralPath $Root).FullName
  $completeFull = ConvertTo-LongPath (Join-Path $rootFull '.complete')
  $fileCount = 0
  $totalBytes = [long]0
  $rootInfo = [System.IO.DirectoryInfo]::new((ConvertTo-LongPath $rootFull))
  foreach ($file in $rootInfo.EnumerateFiles('*', [System.IO.SearchOption]::AllDirectories)) {
    if ($file.FullName -eq $completeFull) { continue }
    $fileCount++
    $totalBytes += $file.Length
  }
  return [pscustomobject]@{ FileCount = $fileCount; TotalBytes = $totalBytes }
}

function Read-CompleteRecord([string]$Path) {
  $raw = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim()
  $fields = $raw -split '\|'
  if ($fields.Count -ne 4) { return $null }
  $fileCount = 0
  $totalBytes = [long]0
  if (-not [int]::TryParse($fields[2], [ref]$fileCount)) { return $null }
  if (-not [long]::TryParse($fields[3], [ref]$totalBytes)) { return $null }
  if ($fileCount -le 0 -or $totalBytes -le 0) { return $null }
  return [pscustomobject]@{
    Id = $fields[0].ToLowerInvariant()
    ArchiveHash = $fields[1].ToLowerInvariant()
    FileCount = $fileCount
    TotalBytes = $totalBytes
  }
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
  $modeStartedAt = Get-Date

  if ($Mode -eq 'cache') {
    foreach ($component in $components) {
      $componentStartedAt = Get-Date
      $marker = Join-Path $PluginDir "component-$($component.Key).cache-valid"
      Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
      $target = Join-Path (Join-Path $RuntimeRoot $component.Key) $component.Id
      $complete = Join-Path $target '.complete'
      $sentinel = Join-Path $target $component.Sentinel
      try {
        $rejected = $null
        if (-not (Test-Path -LiteralPath $complete -PathType Leaf)) {
          $rejected = 'missing-complete'
        }
        if (-not $rejected) {
          $record = Read-CompleteRecord $complete
          if ($null -eq $record -or $record.Id -ne $component.Id) { $rejected = 'record-mismatch' }
        }
        if (-not $rejected -and -not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
          $rejected = 'missing-sentinel'
        }
        if (-not $rejected) {
          $actualHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
          if ($actualHash -ne $component.SentinelHash) { $rejected = 'sentinel-hash' }
        }
        # Deep audit only. The cheap checks above already reject anything an
        # interrupted install can produce, because the completion record is
        # published after the tree is in place; re-measuring every file mainly
        # detects later out-of-band tampering and must not tax every upgrade.
        if (-not $rejected -and $DeepAudit) {
          $measured = Measure-ComponentTree $target
          if ($measured.FileCount -ne $record.FileCount -or $measured.TotalBytes -ne $record.TotalBytes) {
            $rejected = 'tree-audit'
          }
        }
        if ($rejected) {
          Add-Timing "phase=component-cache-rejected component=$($component.Key) reason=$rejected elapsed_ms=$(Get-ElapsedMilliseconds $componentStartedAt)"
          continue
        }
        Remove-Item -LiteralPath "$target.installing" -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType File -Path $marker -Force | Out-Null
        Write-Output "cache-hit:$($component.Key)"
        Add-Timing "phase=component-cache-validated component=$($component.Key) elapsed_ms=$(Get-ElapsedMilliseconds $componentStartedAt)"
      } catch {
        Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
        Add-Timing "phase=component-cache-rejected component=$($component.Key) reason=error elapsed_ms=$(Get-ElapsedMilliseconds $componentStartedAt)"
      }
    }
    Add-Timing "phase=validate-cache-complete elapsed_ms=$(Get-ElapsedMilliseconds $modeStartedAt)"
    exit 0
  }

  foreach ($component in $components) {
    $marker = Join-Path $PluginDir "component-$($component.Key).cache-valid"
    if (Test-Path -LiteralPath $marker -PathType Leaf) { continue }

    $archivePath = Join-Path $PluginDir "component-$($component.Key).7z"
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
      Stop-WithCode 1 "Missing component archive: $($component.Key)"
    }
    # The staged archive is not re-hashed: it came out of the installer's own
    # payload, 7z verifies per-entry CRCs during extraction, and the sentinel
    # hash plus manifest binding pin the expanded content. Re-reading every
    # archive only added install time without adding integrity.
    $componentStartedAt = Get-Date
    Add-Timing "phase=component-expand-start component=$($component.Key)"
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
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $installing -Destination $target -ErrorAction Stop
      # An interrupted move can leave the target directory incomplete, so
      # re-verify the sentinel in place and only then publish the measured
      # completion record that later cache validation depends on.
      $movedSentinel = Join-Path $target $component.Sentinel
      if (-not (Test-Path -LiteralPath $movedSentinel -PathType Leaf)) {
        Stop-WithCode 4 "extract-failed:$($component.Key):moved-tree-incomplete"
      }
      $movedSentinelHash = (Get-FileHash -LiteralPath $movedSentinel -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
      if ($movedSentinelHash -ne $component.SentinelHash) {
        Stop-WithCode 4 "extract-failed:$($component.Key):moved-sentinel-mismatch"
      }
      $measured = Measure-ComponentTree $target
      Set-Content -LiteralPath (Join-Path $target '.complete') -Value "$($component.Id)|$($component.ArchiveHash)|$($measured.FileCount)|$($measured.TotalBytes)" -NoNewline
      Write-Output "expanded:$($component.Key)"
      Add-Timing "phase=component-expand-complete component=$($component.Key) elapsed_ms=$(Get-ElapsedMilliseconds $componentStartedAt)"
    } catch {
      Stop-WithCode 4 "extract-failed:$($component.Key):$($_.Exception.Message)"
    } finally {
      Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    }
  }
  Add-Timing "phase=component-batch-expand-complete elapsed_ms=$(Get-ElapsedMilliseconds $modeStartedAt)"
} catch {
  Add-Timing "phase=validator-failed mode=$Mode elapsed_ms=$(Get-ElapsedMilliseconds $modeStartedAt)"
  Stop-WithCode 1 $_.Exception.Message
}
