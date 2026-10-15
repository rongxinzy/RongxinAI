# Read-only preflight shared by native installer and uninstaller. Paths are
# command-line data, never interpolated into PowerShell source.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$AppDataRoot,
  [ValidateSet('install', 'uninstall')][string]$Mode = 'install'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-SafeFullPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '["\r\n]' -or $Path -notmatch '^[a-zA-Z]:[\\/]') {
    throw "A local absolute directory is required: $Path"
  }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd([char]0x5c, [char]0x2f)
  if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd([char]0x5c, [char]0x2f)) {
    throw "A drive root cannot be an application directory: $Path"
  }
  return $full
}
function Test-ContainsPath([string]$Parent, [string]$Child) {
  return [string]::Equals($Parent, $Child, [StringComparison]::OrdinalIgnoreCase) -or
    $Child.StartsWith($Parent.TrimEnd([char]0x5c) + [char]0x5c, [StringComparison]::OrdinalIgnoreCase)
}
function Assert-PhysicalPath([string]$Path) {
  # GetAttributes also catches a directory link whose target is missing.
  for ($part = [IO.DirectoryInfo]::new($Path); $null -ne $part; $part = $part.Parent) {
    if (Test-Path -LiteralPath $part.FullName) {
      $attributes = [IO.File]::GetAttributes($part.FullName)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Directory links cannot establish installation ownership: $($part.FullName)"
      }
      if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
        throw "Expected a directory: $($part.FullName)"
      }
    } else {
      # PowerShell Test-Path may report false for a dangling junction.
      try { $attributes = [IO.File]::GetAttributes($part.FullName) }
      catch [IO.FileNotFoundException] { continue }
      catch [IO.DirectoryNotFoundException] { continue }
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Dangling directory link is unsafe: $($part.FullName)"
      }
    }
  }
}

$install = Get-SafeFullPath $InstallDir
$runtime = Get-SafeFullPath $RuntimeRoot
$appData = Get-SafeFullPath $AppDataRoot
foreach ($protected in @($runtime, $appData)) {
  if ((Test-ContainsPath $install $protected) -or (Test-ContainsPath $protected $install)) {
    throw 'Installation directory overlaps application data or shared runtime cache'
  }
}
foreach ($checked in @($install, $runtime, $appData)) {
  foreach ($folder in @('UserProfile', 'DesktopDirectory', 'MyDocuments', 'ApplicationData', 'LocalApplicationData', 'Windows', 'ProgramFiles', 'ProgramFilesX86', 'CommonApplicationData')) {
    $protected = [Environment]::GetFolderPath([Environment+SpecialFolder]::$folder)
    if ($protected -and (Test-ContainsPath $checked ([IO.Path]::GetFullPath($protected).TrimEnd([char]0x5c)))) {
      throw "System or personal root (or its ancestor) is protected: $checked"
    }
  }
  # No installation/runtime/user-data root may live anywhere inside the OS.
  foreach ($folder in @('Windows', 'System', 'SystemX86')) {
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::$folder)
    if ($system -and (Test-ContainsPath ([IO.Path]::GetFullPath($system).TrimEnd([char]0x5c)) $checked)) {
      throw "Windows system directory trees are protected: $checked"
    }
  }
  Assert-PhysicalPath $checked
}

$exists = [IO.Directory]::Exists($install)
$nonempty = $exists -and @([IO.Directory]::EnumerateFileSystemEntries($install)).Count -gt 0
if ($Mode -eq 'uninstall' -or $nonempty) {
  # Use Unicode codepoints so Windows PowerShell 5.1 does not depend on the
  # source file's encoding to identify the shipping executable.
  $executable = Join-Path $install (([char]0x77e5).ToString() + [char]0x8fdc + '.exe')
  $resources = Join-Path $install 'resources'
  $asar = Join-Path $resources 'app.asar'
  Assert-PhysicalPath $resources
  foreach ($file in @($executable, $asar)) {
    if (-not [IO.File]::Exists($file) -or ([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Directory does not contain a physical owned installation: $file"
    }
  }
}
Write-Output "validated-install-root mode=$Mode"
