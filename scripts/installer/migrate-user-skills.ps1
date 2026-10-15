# Preserve user-created Skills across interrupted upgrades. The source root may
# be the application's managed component junction; children must be real files.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path -LiteralPath $Source -PathType Container)) { exit 0 }

function Copy-MissingSkillFiles([string]$From, [string]$To) {
  $item = Get-Item -LiteralPath $From -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "User Skill source contains a link: $From"
  }
  for ($parent = [IO.DirectoryInfo]::new($To); $null -ne $parent; $parent = $parent.Parent) {
    if ($parent.Exists -and ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "User Skill destination contains a directory link: $To"
    }
  }
  [IO.Directory]::CreateDirectory($To) | Out-Null
  foreach ($child in @(Get-ChildItem -LiteralPath $From -Force)) {
    if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "User Skill source contains a link: $($child.FullName)"
    }
    $target = Join-Path $To $child.Name
    if ($child.PSIsContainer) { Copy-MissingSkillFiles $child.FullName $target; continue }
    if (Test-Path -LiteralPath $target) { continue }
    $temporary = $target + '.migration.' + [Guid]::NewGuid().ToString('n')
    try {
      [IO.File]::Copy($child.FullName, $temporary, $false)
      [IO.File]::Move($temporary, $target)
    } finally {
      if (Test-Path -LiteralPath $temporary) { [IO.File]::Delete($temporary) }
    }
  }
}

$bundled = @()
$config = Join-Path $Source 'skills.config.json'
if (Test-Path -LiteralPath $config -PathType Leaf) {
  # Do not silently classify a damaged bundled manifest as user files.
  $manifest = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  if ($manifest.PSObject.Properties.Name -contains 'defaults') {
    $bundled = @($manifest.defaults.PSObject.Properties | ForEach-Object { $_.Name })
  }
}
foreach ($skill in @(Get-ChildItem -LiteralPath $Source -Directory -Force)) {
  if ($bundled -contains $skill.Name) { continue }
  Copy-MissingSkillFiles $skill.FullName (Join-Path $Destination $skill.Name)
}
