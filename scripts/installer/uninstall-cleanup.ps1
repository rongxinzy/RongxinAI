# Remove only this application's current component caches. Personal data and
# unrelated or historical runtime directories are deliberately retained.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot
)
$ErrorActionPreference = 'Stop'

function Assert-PhysicalPath([string]$Path) {
  for ($directory = [IO.DirectoryInfo]::new($Path); $null -ne $directory; $directory = $directory.Parent) {
    if ($directory.Exists -and ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Unsafe cleanup root: $Path"
    }
  }
}
Assert-PhysicalPath $InstallDir
Assert-PhysicalPath $RuntimeRoot
$resources = Join-Path $InstallDir 'resources'
Assert-PhysicalPath $resources
$prefixes = @('channel-runtime', 'SKILLs', 'MCPs', 'mingit', 'python-win', 'skill-python', 'uv-win')
foreach ($prefix in $prefixes) {
  $link = Join-Path $resources $prefix
  if (Test-Path -LiteralPath $link) {
    $item = Get-Item -LiteralPath $link -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($link) }
  }
}

function Remove-TreeWithoutFollowingLinks([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName) }
    else { [IO.File]::Delete($item.FullName) }
    return
  }
  if ($item.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
      Remove-TreeWithoutFollowingLinks $child.FullName
    }
    [IO.Directory]::Delete($item.FullName)
  } else {
    if ($item.IsReadOnly) { $item.IsReadOnly = $false }
    [IO.File]::Delete($item.FullName)
  }
}
foreach ($key in @('channel-runtime', 'skills', 'mcps', 'portable-git', 'python', 'skill-python', 'uv')) {
  $root = Join-Path $RuntimeRoot $key
  Assert-PhysicalPath $root
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($pointerName in @('current', 'current.next', 'current.previous')) {
    $pointer = Join-Path $root $pointerName
    if (Test-Path -LiteralPath $pointer) {
      $item = Get-Item -LiteralPath $pointer -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($pointer) }
    }
  }
  foreach ($version in @(Get-ChildItem -LiteralPath $root -Directory)) {
    if ($version.Name -cnotmatch '^[0-9a-f]{64}\z' -or
        ($version.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    $complete = Join-Path $version.FullName '.complete'
    if (-not (Test-Path -LiteralPath $complete -PathType Leaf)) { continue }
    if (((Get-Item -LiteralPath $complete -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if (((Get-Content -LiteralPath $complete -Raw) -split '\|', 2)[0] -cne $version.Name) { continue }
    Remove-TreeWithoutFollowingLinks $version.FullName
  }
}
