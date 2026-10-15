# Shared post-install cleanup. Only a recorded transaction backup and verified
# versions of the current component may be reclaimed; unrelated/retired data
# stays in place. Both installers orchestrate via this script.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$OldInstallPathFile,
  [AllowEmptyString()][string]$OldInstallPath,
  [switch]$UseExactOldInstallPath
)

$ErrorActionPreference = 'Stop'

function Get-NormalizedDirectoryPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-PhysicalDirectoryPath([string]$Path) {
  # A physical leaf underneath a junction still points outside the owned tree.
  for ($directory = [IO.DirectoryInfo]::new($Path); $null -ne $directory; $directory = $directory.Parent) {
    if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Unsafe cleanup directory link: $($directory.FullName)"
    }
  }
}

# Validate the complete manifest before changing any files. Retired components
# and malformed content IDs must never turn a manifest into arbitrary paths.
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$rows = @($manifest.components)
$expectedKeys = @('channel-runtime', 'mcps', 'portable-git', 'python', 'skill-python', 'skills', 'uv')
if ($rows.Count -ne 7 -or (@($rows | ForEach-Object { [string]$_.key } | Sort-Object) -join ',') -cne ($expectedKeys -join ',')) {
  throw 'Invalid cleanup manifest: component set does not match this application'
}
foreach ($row in $rows) {
  if ([string]$row.contentId -cnotmatch '^[0-9a-f]{64}\z') { throw 'Invalid cleanup content ID' }
  Assert-PhysicalDirectoryPath (Join-Path $RuntimeRoot $row.key)
}

# The shell always selects exact-path mode, even when a fresh install has no
# backup. Only the NSIS caller falls back to its exact transaction marker.
# Never infer ownership by scanning siblings, even for a GUID-shaped name.
$fromMarker = -not $UseExactOldInstallPath -and -not $PSBoundParameters.ContainsKey('OldInstallPath')
if ($fromMarker -and (Test-Path -LiteralPath $OldInstallPathFile)) {
  $OldInstallPath = (Get-Content -LiteralPath $OldInstallPathFile -Raw).Trim()
}
$backup = $null
if (-not [string]::IsNullOrEmpty($OldInstallPath)) {
  $installFull = Get-NormalizedDirectoryPath $InstallDir
  $backup = Get-NormalizedDirectoryPath $OldInstallPath
  # NSIS uses GetTickCount; the shell uses Guid.ToString("n"). Anchor the
  # entire literal install path, including any [] or other regex characters.
  $backupPattern = '^' + [regex]::Escape($installFull) + '\.old\.(?:[0-9a-f]{32}|-?[0-9]{1,10})\z'
  if ($backup -notmatch $backupPattern) { throw "Unowned previous installation: $OldInstallPath" }
  Assert-PhysicalDirectoryPath $backup
}

# Compare both sides with the same normalization. Windows PowerShell's .NET
# Framework can expand an existing 8.3 path (for example RUNNER~1), so comparing
# the raw marker with $backup would leave this transaction's marker behind.
# Resolve ownership before the background worker can remove the named folder.
$ownedMarker = $null
if ($backup -and (Test-Path -LiteralPath $OldInstallPathFile)) {
  $markerContent = Get-Content -LiteralPath $OldInstallPathFile -Raw
  try {
    $markerBackup = Get-NormalizedDirectoryPath $markerContent.Trim()
    if ([string]::Equals($markerBackup, $backup, [StringComparison]::OrdinalIgnoreCase)) {
      $ownedMarker = $markerContent
    }
  } catch {
    # A stale or malformed marker is not proof of ownership; leave it alone.
    Write-Verbose 'Preserving an invalid previous-install marker'
  }
}

# Every recursive step checks for links before enumerating. This also protects
# nested junctions (not just the former resources/mingit link) and avoids the
# PowerShell 5.1 recursive removal behavior on directory junctions.
$deleteTree = {
  function Remove-TreeWithoutFollowingLinks([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
      else { [IO.File]::Delete($item.FullName) }
      return
    }
    if ($item.PSIsContainer) {
      foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
        Remove-TreeWithoutFollowingLinks $child.FullName
      }
      [IO.Directory]::Delete($item.FullName)
    } else {
      if ($item.IsReadOnly) { $item.IsReadOnly = $false }
      [IO.File]::Delete($item.FullName)
    }
  }
}
. $deleteTree

if ($backup -and (Test-Path -LiteralPath $backup -PathType Container)) {
  # Slow disks must not block setup. An inherited variable carries one literal
  # path; no path text is interpolated into executable code or split on lines.
  $previousTarget = $env:ZY_CLEANUP_TARGET
  try {
    $env:ZY_CLEANUP_TARGET = $backup
    $cleanupScript = $deleteTree.ToString() + @'

$ErrorActionPreference = 'Stop'
$target = $env:ZY_CLEANUP_TARGET
for ($directory = [IO.DirectoryInfo]::new($target); $null -ne $directory; $directory = $directory.Parent) {
  if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Previous installation became a directory link; preserving it'
  }
}
if (Test-Path -LiteralPath $target -PathType Container) { Remove-TreeWithoutFollowingLinks $target }
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupScript))
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded | Out-Null
  } finally {
    $env:ZY_CLEANUP_TARGET = $previousTarget
  }
}
if ($null -ne $ownedMarker -and (Test-Path -LiteralPath $OldInstallPathFile) -and
    (Get-Content -LiteralPath $OldInstallPathFile -Raw) -ceq $ownedMarker) {
  Remove-Item -LiteralPath $OldInstallPathFile -Force
}

# Reclaim only owned content-addressed versions of the current component.
# Unknown folders and retired runtime-packs are user data, not cleanup targets.
foreach ($row in $rows) {
$root = Join-Path $RuntimeRoot $row.key
foreach ($pointerName in @('current.previous', 'current.next')) {
  $pointer = Join-Path $root $pointerName
  if (Test-Path -LiteralPath $pointer) {
    $item = Get-Item -LiteralPath $pointer -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($pointer) }
  }
}
foreach ($version in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
  if ($version.Name -ceq [string]$row.contentId -or $version.Name -cnotmatch '^[0-9a-f]{64}\z') { continue }
  if (($version.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
  $complete = Join-Path $version.FullName '.complete'
  if (-not (Test-Path -LiteralPath $complete -PathType Leaf)) { continue }
  $completeItem = Get-Item -LiteralPath $complete -Force
  if (($completeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
  $completion = Get-Content -LiteralPath $complete -Raw
  if (-not $completion -or ($completion -split '\|', 2)[0] -cne $version.Name) { continue }
  Remove-TreeWithoutFollowingLinks $version.FullName
}

}
