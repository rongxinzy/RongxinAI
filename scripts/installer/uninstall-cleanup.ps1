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
# 'llamacpp-bundled' is the cpu/cuda editions' bundled llama.cpp runtime component.
$prefixes = @('channel-runtime', 'SKILLs', 'MCPs', 'mingit', 'python-win', 'skill-python', 'uv-win', 'llamacpp-bundled')
foreach ($prefix in $prefixes) {
  $link = Join-Path $resources $prefix
  if (Test-Path -LiteralPath $link) {
    $item = Get-Item -LiteralPath $link -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($link) }
  }
}

# Component versions routinely contain paths past MAX_PATH (jedi typeshed stubs,
# OCP .libs), and the PowerShell provider reports those as missing, which aborted
# this script halfway and left a partially deleted cache behind.
function ConvertTo-LongPath([string]$Path) {
  if ($Path.StartsWith('\\?\')) { return $Path }
  if ($Path.StartsWith('\\')) { return '\\?\UNC\' + $Path.Substring(2) }
  return '\\?\' + $Path
}

function Remove-TreeWithoutFollowingLinks([string]$Path) {
  $long = ConvertTo-LongPath $Path
  if ([IO.Directory]::Exists($long)) {
    if (([IO.File]::GetAttributes($long) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      [IO.Directory]::Delete($long)
      return
    }
    foreach ($child in [IO.Directory]::GetFileSystemEntries($long)) {
      Remove-TreeWithoutFollowingLinks $child
    }
    [IO.Directory]::Delete($long)
    return
  }
  if (-not [IO.File]::Exists($long)) { return }
  if (([IO.File]::GetAttributes($long) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    [IO.File]::Delete($long)
    return
  }
  if (([IO.File]::GetAttributes($long) -band [IO.FileAttributes]::ReadOnly) -ne 0) {
    [IO.File]::SetAttributes($long, [IO.FileAttributes]::Normal)
  }
  [IO.File]::Delete($long)
}
foreach ($key in @('channel-runtime', 'skills', 'mcps', 'portable-git', 'python', 'skill-python', 'uv', 'llamacpp-bundled')) {
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
    # Drop the completion marker first: if this deletion is interrupted (locked
    # file, power loss) the next install must treat the version as incomplete and
    # re-extract it instead of linking a half-deleted tree.
    [IO.File]::Delete((ConvertTo-LongPath $complete))
    Remove-TreeWithoutFollowingLinks $version.FullName
  }
}
