param(
  [Parameter(Mandatory = $true)][ValidateSet('prepare', 'verify')][string]$Action,
  [string]$ProjectRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '../..')),
  [string]$ExpectedThumbprint = '',
  [switch]$OwnedAcceptanceContext
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. ([IO.Path]::Combine($PSScriptRoot, 'windows-shell-uninstall-helpers.ps1'))
if ($env:OS -ne 'Windows_NT' -or -not $env:RUNNER_TEMP -or
    ($env:GITHUB_ACTIONS -cne 'true' -and -not $OwnedAcceptanceContext)) {
  throw 'Native uninstall acceptance requires a fresh Windows CI runner or explicit owned acceptance context'
}
Initialize-AcceptanceModules
$commit = if ($env:ZHIYUAN_SOURCE_COMMIT) { $env:ZHIYUAN_SOURCE_COMMIT } else { $env:GITHUB_SHA }
$runId = $env:GITHUB_RUN_ID
if ($commit -cnotmatch '^[0-9a-f]{40}$' -or $runId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'Exact acceptance build and run identity is required' }
$runnerRoot = Get-NormalizedAcceptancePath $env:RUNNER_TEMP
if ($OwnedAcceptanceContext -and [IO.Path]::GetFileName($runnerRoot) -cnotmatch '^zhiyuan-package-acceptance-[a-f0-9]{32}$') {
  throw 'Explicit package acceptance requires its newly created GUID-owned temporary directory'
}
$runtimeRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ZhiYuanAgent/runtimes'
$defaultData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ZhiYuanAgent'
Assert-PhysicalAcceptancePath $runnerRoot
Assert-PhysicalAcceptancePath $runtimeRoot
Assert-PhysicalAcceptancePath $defaultData
$leasePath = Join-Path $runnerRoot 'zhiyuan-native-uninstall-lease.json'

if ($Action -eq 'prepare') {
  # Before any install smoke: a pre-existing cache can belong to another app
  # installation. Never delete or adopt it just to make acceptance pass.
  if ((Test-Path -LiteralPath $runtimeRoot) -or (Test-Path -LiteralPath $leasePath)) {
    throw 'Uninstall acceptance requires a fresh runner with no standard runtime or previous lease'
  }
  [ordered]@{
    kind = 'native-uninstall-runtime-lease'; version = 1; initiallyAbsent = $true
    commit = $commit; runId = $runId; runtimeRoot = $runtimeRoot; runnerRoot = $runnerRoot
  } | ConvertTo-Json | Set-Content -LiteralPath $leasePath -Encoding UTF8
  Write-Output 'Prepared current-run ownership lease before any native install smoke'
  exit 0
}

$lease = Get-Content -LiteralPath $leasePath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-AcceptanceLease $lease $commit $runId $runtimeRoot $runnerRoot
$evidence = Join-Path $ProjectRoot 'acceptance-diagnostics/shell-uninstall'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$sandbox = Join-Path $runnerRoot 'zhiyuan-shell-acceptance'
$unicodeInstallName = ([char]0x5b89).ToString() + [char]0x88c5 + [char]0x8def + [char]0x5f84
$installRoot = Join-Path $sandbox $unicodeInstallName
$appName = ([char]0x77e5).ToString() + [char]0x8fdc + '.exe'
$app = Join-Path $installRoot $appName
$customData = Join-Path $sandbox 'app-data'
$customRuntime = Join-Path $sandbox 'runtimes'
Assert-PhysicalAcceptancePath $installRoot
Assert-PhysicalAcceptancePath $customData
Assert-PhysicalAcceptancePath $customRuntime
$shellReport = Get-Content -LiteralPath (Join-Path $ProjectRoot 'acceptance-diagnostics/shell-interactive/report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($shellReport.kind -cne 'webview2-shell-interactive-acceptance' -or $shellReport.passed -ne $true -or
    $shellReport.commit -cne $commit -or $shellReport.runId -cne $runId) {
  throw 'Native uninstall must follow successful real WebView2 acceptance for this exact run'
}
Assert-SameAcceptancePath $shellReport.installedExecutable $app
if ((Get-AcceptanceSha256 $app) -cne $shellReport.installedAppSha256 -or
    (Get-AcceptanceSha256 (Join-Path $installRoot 'resources/app.asar')) -cne $shellReport.installedAsarSha256) {
  throw 'Shell-installed application changed after interactive acceptance'
}
$setups = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter 'ZhiYuanAgent-Setup-*.exe' -File)
if ($setups.Count -ne 1 -or (Get-AcceptanceSha256 $setups[0].FullName) -cne $shellReport.installerSha256) {
  throw 'Uninstall acceptance does not belong to the final shell installer bytes'
}
$setupManifest = Get-Content -LiteralPath ($setups[0].FullName + '.manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($setupManifest.signed -isnot [bool]) { throw 'Final shell manifest must declare a boolean signing state' }
$capturedHost = Join-Path $ProjectRoot 'scripts/installer-shell/out/ZhiYuanUninstall.exe'
$hostManifest = Get-Content -LiteralPath ($capturedHost + '.manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($hostManifest.version -cne $version) { throw 'Captured uninstall host version does not match this build' }
$installedHost = Join-Path $installRoot $hostManifest.installedFileName
Assert-NativeHostIdentity $hostManifest $capturedHost $installedHost $commit
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $installedHost
if ($setupManifest.signed -eq $true -or $ExpectedThumbprint) {
  $thumbprint = ($ExpectedThumbprint -replace '[^a-fA-F0-9]', '').ToUpperInvariant()
  if ($thumbprint -notmatch '^[0-9A-F]{40}$' -or $signature.Status -ne 'Valid' -or
      $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -cne $thumbprint -or
      $null -eq $signature.TimeStamperCertificate) {
    throw 'Signed uninstall host requires the configured valid signer and trusted timestamp'
  }
} elseif ($setupManifest.signed -ne $false -or $signature.Status -ne 'NotSigned') {
  throw 'Unsigned PR acceptance must explicitly have unsigned setup and uninstall host'
}
$guid = '331369f7-5ab3-5702-935d-f3cff6ba8163'
$registrationKeys = @("HKCU:/Software/$guid", "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$guid")
$registration = Get-ItemProperty -LiteralPath $registrationKeys[1]
Assert-NativeUninstallCommands $registration $installedHost $installRoot
Assert-SameAcceptancePath (Get-ItemProperty -LiteralPath $registrationKeys[0]).InstallLocation $installRoot

$preserveFiles = @((Join-Path $customData 'history.sqlite'), (Join-Path $customData 'settings.json'), (Join-Path $customRuntime 'preserved-user-marker'))
$components = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'build-tar/windows-components/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).components
if (@($components).Count -ne 7) { throw 'All seven main application components must remain represented' }
foreach ($component in $components) {
  if ($component.key -notin @('channel-runtime','skills','mcps','portable-git','python','skill-python','uv') -or
      $component.contentId -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid offline component identity' }
  $version = Join-Path (Join-Path $customRuntime $component.key) $component.contentId
  $preserveFiles += @((Join-Path $version '.complete'), (Join-Path $version $component.sentinel))
}
$preservation = @($preserveFiles | ForEach-Object { [ordered]@{ path = $_; sha256 = Get-AcceptanceSha256 $_ } })
$standardFiles = @((Join-Path $runtimeRoot 'acceptance-personal/keep.txt'), (Join-Path $runtimeRoot 'skills/acceptance-unknown/keep.txt'))
foreach ($component in $components) {
  $version = Join-Path (Join-Path $runtimeRoot $component.key) $component.contentId
  $standardFiles += @((Join-Path $version '.complete'), (Join-Path $version $component.sentinel))
}
$standardPreservation = @($standardFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object {
  [ordered]@{ path = $_; sha256 = Get-AcceptanceSha256 $_ }
})
$runtimePrefix = (Get-NormalizedAcceptancePath $runtimeRoot) + [char]0x5c
$installPrefix = (Get-NormalizedAcceptancePath $installRoot) + [char]0x5c
if (@(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $_.ExecutablePath.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase))
}).Count -gt 0) { throw 'Existing app/runtime processes must finish before uninstall isolation' }

$token = [guid]::NewGuid().ToString('n')
$quarantine = $runtimeRoot + '.acceptance-preserved-' + $runId + '-' + $token
$standardSentinel = Join-Path $defaultData ('uninstall-acceptance-' + $token + '.txt')
$report = [ordered]@{
  kind = 'webview2-native-uninstall-acceptance'; passed = $false; commit = $commit; runId = $runId
  installedExecutable = $app; installerSha256 = $shellReport.installerSha256
  hostSha256 = $hostManifest.sha256; hostSignature = [string]$signature.Status
  hostIdentity = $hostManifest; signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { '' }
  timestampPresent = ($null -ne $signature.TimeStamperCertificate)
  uninstallString = $registration.UninstallString; quietUninstallString = $registration.QuietUninstallString
  checks = [ordered]@{}; preservation = $preservation; standardRuntimePreservation = $standardPreservation
  customRoots = 'Custom WebView acceptance data and caches are preserved, not reclaimed by the fixed-root NSIS uninstaller'
  standardRuntime = $runtimeRoot; quarantine = $null; defaultUserDataSentinel = $standardSentinel; errors = @()
}
$movedRuntime = $false
$native = New-Object System.Diagnostics.Process
$nativeStarted = $false
$owned = @{}
function Update-OwnedUninstallProcesses {
  $all = @(Get-CimInstance Win32_Process)
  do {
    $added = $false
    foreach ($process in $all) {
      if ($owned.ContainsKey([int]$process.ParentProcessId) -and -not $owned.ContainsKey([int]$process.ProcessId)) {
        $owned[[int]$process.ProcessId] = $process.CreationDate
        $added = $true
      }
    }
  } while ($added)
  return @($all | Where-Object { $owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId] -eq $_.CreationDate })
}
try {
  if (Test-Path -LiteralPath $runtimeRoot) {
    # The root/ancestors are physical. Internal component junctions are moved
    # as directory entries; this operation never follows or deletes them.
    Assert-AcceptanceLease $lease $commit $runId $runtimeRoot $runnerRoot
    if (Test-Path -LiteralPath $quarantine) { throw 'Runtime quarantine must be a new exact directory' }
    [IO.Directory]::Move($runtimeRoot, $quarantine)
    $movedRuntime = $true
    $report.quarantine = $quarantine
  }
  [IO.Directory]::CreateDirectory($defaultData) | Out-Null
  [IO.File]::WriteAllText($standardSentinel, "Preserve default user data for $commit run $runId")
  $standardSentinelHash = Get-AcceptanceSha256 $standardSentinel
  $report.defaultUserDataSentinelSha256 = $standardSentinelHash
  $native.StartInfo.FileName = $installedHost
  $native.StartInfo.Arguments = '/S'
  $native.StartInfo.UseShellExecute = $false
  $native.StartInfo.WorkingDirectory = $runnerRoot
  $nativeStarted = $native.Start()
  if (-not $nativeStarted) { throw 'Registered native uninstaller did not start' }
  $null = $native.Handle
  $owned[$native.Id] = $native.StartTime
  $deadline = (Get-Date).AddMinutes(10)
  do {
    $active = @(Update-OwnedUninstallProcesses)
    $removed = -not (Test-Path -LiteralPath $installRoot) -and
      @($registrationKeys | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0
    if ($native.HasExited -and $active.Count -eq 0 -and $removed) { break }
    if ((Get-Date) -ge $deadline) { throw 'Native uninstall did not remove app and registration or finish its own process tree within ten minutes' }
    Start-Sleep -Milliseconds 200
  } while ($true)
  $report.nativeExitCode = $native.get_ExitCode()
  if ($report.nativeExitCode -ne 0) { throw "Native uninstaller exited $($report.nativeExitCode)" }
  if ((Get-AcceptanceSha256 $standardSentinel) -cne $standardSentinelHash) { throw 'Normal uninstall changed real default user data' }
  foreach ($entry in $preservation) {
    if ((Get-AcceptanceSha256 $entry.path) -cne $entry.sha256) { throw "Uninstall changed custom-root data: $($entry.path)" }
  }
  $report.checks.exactCapturedNativeHost = $true
  $report.checks.registeredQuietCommand = $true
  $report.checks.nativeUninstallCompleted = $true
  $report.checks.applicationAndRegistrationRemoved = $true
  $report.checks.realDefaultUserDataPreserved = $true
  $report.checks.customDataAndRuntimePreserved = $true
  $report.passed = $true
} catch {
  $report.errors += $_.Exception.ToString()
  throw
} finally {
  try {
    foreach ($process in @(Update-OwnedUninstallProcesses)) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    }
    if ($nativeStarted -and -not $native.HasExited) { $native.Kill(); $null = $native.WaitForExit(5000) }
    if (@(Update-OwnedUninstallProcesses).Count -gt 0) { throw 'Owned uninstall processes remain active; runtime quarantine retained for safety' }
    if ($movedRuntime) { Restore-AcceptanceRuntime $quarantine $runtimeRoot }
    foreach ($entry in $standardPreservation) {
      if ((Get-AcceptanceSha256 $entry.path) -cne $entry.sha256) { throw "Earlier native test cache changed during isolation: $($entry.path)" }
    }
    $report.checks.standardRuntimeRestored = $true
  } catch {
    $report.passed = $false
    $report.errors += $_.Exception.ToString()
  }
  $native.Dispose()
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidence 'report.json') -Encoding UTF8
}
if (-not $report.passed) { throw ($report.errors -join "`n") }
Write-Output 'PASS: exact native host uninstalls the real WebView installation and preserves user data'
