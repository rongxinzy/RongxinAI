# Side-effect-free definitions used by the disposable-runner acceptance driver.
function Get-NormalizedAcceptancePath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([char]0x5c, [char]0x2f)
}

function Assert-SameAcceptancePath([string]$Actual, [string]$Expected) {
  if (-not [string]::Equals((Get-NormalizedAcceptancePath $Actual), (Get-NormalizedAcceptancePath $Expected), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Acceptance path mismatch: expected $Expected, received $Actual"
  }
}

function Assert-PhysicalAcceptancePath([string]$Path) {
  for ($part = [IO.DirectoryInfo]::new($Path); $null -ne $part; $part = $part.Parent) {
    try { $attributes = [IO.File]::GetAttributes($part.FullName) }
    catch [IO.FileNotFoundException] { continue }
    catch [IO.DirectoryNotFoundException] { continue }
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
      throw "Acceptance root or ancestor is not a physical directory: $($part.FullName)"
    }
  }
}

function Assert-AcceptanceLease {
  param([object]$Lease, [string]$Commit, [string]$RunId, [string]$RuntimeRoot, [string]$RunnerRoot)
  if ($Lease.kind -cne 'native-uninstall-runtime-lease' -or $Lease.version -ne 1 -or
      $Lease.initiallyAbsent -ne $true -or $Lease.commit -cne $Commit -or $Lease.runId -cne $RunId) {
    throw 'Runtime isolation requires an absent-at-start lease for this exact build and run'
  }
  Assert-SameAcceptancePath $Lease.runtimeRoot $RuntimeRoot
  Assert-SameAcceptancePath $Lease.runnerRoot $RunnerRoot
  Assert-PhysicalAcceptancePath $RuntimeRoot
  Assert-PhysicalAcceptancePath $RunnerRoot
}

function Restore-AcceptanceRuntime([string]$Quarantine, [string]$RuntimeRoot) {
  if (-not [IO.Directory]::Exists($Quarantine)) { throw "Owned runtime quarantine disappeared: $Quarantine" }
  Assert-PhysicalAcceptancePath $Quarantine
  Assert-PhysicalAcceptancePath $RuntimeRoot
  if (Test-Path -LiteralPath $RuntimeRoot) {
    throw "Refusing to overwrite a new runtime directory. Preserved original remains at $Quarantine"
  }
  [IO.Directory]::Move($Quarantine, $RuntimeRoot)
}

function Get-AcceptanceSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-NativeHostIdentity {
  param([object]$Manifest, [string]$CapturedHost, [string]$InstalledHost, [string]$Commit)
  if ($Manifest.kind -cne 'nsis-uninstall-host' -or $Manifest.sourceCommit -cne $Commit -or
      $Manifest.sha256 -cnotmatch '^[0-9a-f]{64}$' -or $Manifest.sha256 -cne $Manifest.sourceSha256) {
    throw 'Uninstaller capture manifest does not belong to this source build'
  }
  if ([IO.Path]::GetFileName($Manifest.installedFileName) -cne $Manifest.installedFileName -or
      $Manifest.installedFileName -notmatch '^Uninstall .+\.exe$') {
    throw 'Captured NSIS uninstaller filename is invalid'
  }
  if ([IO.Path]::GetFileName($InstalledHost) -ine $Manifest.installedFileName) {
    throw 'Installed native host must retain its original NSIS filename'
  }
  foreach ($file in @($CapturedHost, $InstalledHost)) {
    $item = Get-Item -LiteralPath $file -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $item.Length -ne $Manifest.bytes -or (Get-AcceptanceSha256 $file) -cne $Manifest.sha256) {
      throw "Native uninstaller is not the exact captured post-sign bytes: $file"
    }
  }
}

function Assert-NativeUninstallCommands {
  param([object]$Registration, [string]$InstalledHost, [string]$InstallRoot)
  Assert-SameAcceptancePath $Registration.InstallLocation $InstallRoot
  if ($Registration.UninstallString -cne ('"' + $InstalledHost + '"') -or
      $Registration.QuietUninstallString -cne ('"' + $InstalledHost + '" /S')) {
    throw 'Registered native uninstaller must preserve its exact quoted executable and /S contract'
  }
}
