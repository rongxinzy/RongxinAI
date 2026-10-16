param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
  [int]$TimeoutSeconds = 900,
  [int]$ExpectedDpi = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Interactive NSIS acceptance requires Windows' }
if (-not $env:RUNNER_TEMP) { throw 'Run only on a disposable Windows acceptance runner' }
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'windows-installer-ui.cs') -ReferencedAssemblies System,System.Core,System.Drawing
[ZhiYuan.Acceptance.InstallerUi]::UsePhysicalCoordinates()
$actionFont = [ZhiYuan.Acceptance.InstallerUi]::ReadActionFontContract((Join-Path $ProjectRoot 'scripts/installer-ui/zy-theme.nsh'))

$evidence = Join-Path $ProjectRoot 'acceptance-diagnostics/interactive'
$installRoot = Join-Path $env:RUNNER_TEMP 'zhiyuan-interactive-acceptance/安装路径'
if (Test-Path -LiteralPath $installRoot) { throw 'Interactive acceptance requires a fresh CI-owned install directory' }
New-Item -ItemType Directory -Force $evidence,(Split-Path $installRoot) | Out-Null
$installers = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter '*.exe' -File |
  Where-Object { $_.Name -notlike '*Uninstall*' -and $_.Name -notlike 'ZhiYuanAgent-Setup-*' })
if ($installers.Count -ne 1) { throw "Expected one real NSIS installer, found $($installers.Count)" }
$installer = $installers[0]
if ((Get-AuthenticodeSignature -LiteralPath $installer.FullName).Status -ne 'NotSigned') {
  throw 'Interactive acceptance expects the explicitly unsigned acceptance installer'
}
$app = Join-Path $installRoot '知远.exe'
$launchBackup = "$app.acceptance-launch-held"
$script:installerProcesses = New-Object 'System.Collections.Generic.HashSet[int]'
$script:wizard = $null
$fileLock = $null
$started = Get-Date
$report = [ordered]@{
  kind = 'nsis-interactive-acceptance'; passed = $false
  commit = $env:GITHUB_SHA; runId = $env:GITHUB_RUN_ID
  installerSha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  installedExecutable = $app; checks = [ordered]@{}; pages = @(); errors = @()
  dpiCoverage = 'Actual window DPI only; no simulated high-DPI claim'
  actionFont = $actionFont
  fontCoverage = 'Production theme font recreated locally; real control bounds and actual HWND DPI'
}

function Wait-Until {
  param([scriptblock]$Check, [string]$Label, [int]$Seconds = 60)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $value = & $Check
    if ($value) { return $value }
    Start-Sleep -Milliseconds 150
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Label (${Seconds}s)"
}

function Update-InstallerProcesses {
  # NSIS can spawn a second executable; track descendants instead of guessing
  # a process name or accepting an unrelated desktop window.
  $processes = @(Get-CimInstance Win32_Process)
  do {
    $added = $false
    foreach ($item in $processes) {
      if ($script:installerProcesses.Contains([int]$item.ParentProcessId)) {
        if ($script:installerProcesses.Add([int]$item.ProcessId)) { $added = $true }
      }
    }
  } while ($added)
}

function Get-InstallerWindows {
  Update-InstallerProcesses
  @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object {
    $script:installerProcesses.Contains($_.ProcessId) -and $_.ClassName -eq '#32770'
  })
}

function Get-Controls {
  param([long]$Window = $script:wizard.Handle)
  @([ZhiYuan.Acceptance.InstallerUi]::Controls($Window))
}

function Normalize-Label {
  param([string]$Text)
  ($Text.Replace('&', '') -replace '\s*\([A-Za-z]\)', '').Trim()
}

function Get-Button {
  param([int]$Id = -1, [string]$Label = '', [long]$Window = $script:wizard.Handle)
  $buttons = @(Get-Controls $Window | Where-Object {
    $_.Visible -and $_.ClassName -eq 'Button' -and
    ($Id -lt 0 -or $_.ControlId -eq $Id) -and
    (-not $Label -or (Normalize-Label $_.Text) -match $Label)
  })
  if ($buttons.Count -gt 1) { throw "Ambiguous visible button: id=$Id label=$Label" }
  if ($buttons.Count -eq 1) { return $buttons[0] }
}

function Save-Page {
  param([string]$Name, [long]$Window = $script:wizard.Handle)
  $windowInfo = @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object Handle -eq $Window)[0]
  $controls = @(Get-Controls $Window)
  $png = Join-Path $evidence "$Name.png"
  [ZhiYuan.Acceptance.InstallerUi]::Capture($Window, $png)
  $page = [ordered]@{ name = $Name; screenshot = "$Name.png"; window = $windowInfo; controls = $controls }
  $page | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $evidence "$Name.json")
  $report.pages += $page
  Write-Host "[InstallerInteractive] Captured $Name at $($windowInfo.Dpi) DPI"
}

function Start-Installer {
  param([ValidateSet(2052, 1033)][int]$Language = 2052)
  # Deliberately no /S: this is the actual packaged wizard. /D stays last,
  # unquoted as required by NSIS, including the Unicode destination.
  # /LANGUAGE is parsed by production ApplyRequestedInstallerLanguage; it is
  # not a built-in NSIS/MUI option and must never be assumed to work by itself.
  $process = Start-Process -FilePath $installer.FullName -ArgumentList "/LANGUAGE=$Language /D=$installRoot" -PassThru
  $script:installerProcesses.Add($process.Id) | Out-Null
  $script:wizard = Wait-Until {
    foreach ($window in (Get-InstallerWindows)) {
      if (Get-Button -Label '^(安装|安裝|Install)$' -Window $window.Handle) { return $window }
    }
  } 'visible installer welcome page'
  if ($ExpectedDpi -gt 0 -and $script:wizard.Dpi -ne $ExpectedDpi) {
    throw "Expected actual $ExpectedDpi DPI, received $($script:wizard.Dpi); no simulated DPI acceptance"
  }
  $expectedInstall = if ($Language -eq 2052) { '安装' } else { 'Install' }
  if ((Normalize-Label (Get-Button -Label '^(安装|安裝|Install)$').Text) -ne $expectedInstall) {
    throw "The real installer did not display the requested language $Language"
  }
  $script:language = $Language
  return $process
}

function Begin-Installation {
  param([string]$Name)
  $install = Get-Button -Label '^(安装|安裝|Install)$'
  $license = Get-Button -Label '^(已阅读并同意|已閱讀並同意|I agree to the)$'
  $licenseLink = Get-Button -Label '^(《许可协议》|《授權協議》|License)$'
  $cancel = Get-Button -Label '^(取消|Cancel)$'
  if (-not $install -or -not $license -or -not $licenseLink -or -not $cancel) { throw 'Welcome page is missing a required action' }
  if ($install.Enabled) { throw 'Install must be disabled until the license is accepted' }
  if ([ZhiYuan.Acceptance.InstallerUi]::Checked($license.Handle) -ne 0) { throw 'License must start unchecked' }
  foreach ($control in @($install, $license, $licenseLink, $cancel)) {
    $weight = if ($control.Handle -eq $license.Handle -or $control.Handle -eq $licenseLink.Handle) { $actionFont.BodyWeight } else { $actionFont.ButtonWeight }
    [ZhiYuan.Acceptance.InstallerUi]::AssertActionLayout($script:wizard.Handle, $control.Handle, $actionFont.Family, $actionFont.Points, $weight)
  }
  Save-Page "$Name-welcome"
  [ZhiYuan.Acceptance.InstallerUi]::Click($license.Handle)
  $install = Wait-Until {
    $button = Get-Button -Label '^(安装|安裝|Install)$'
    if ($button -and $button.Enabled) { return $button }
  } 'license-gated Install action'
  Save-Page "$Name-ready"
  [ZhiYuan.Acceptance.InstallerUi]::Click($install.Handle)
}

function Wait-ForProgressAndFinish {
  param([string]$Name)
  $expectedTitle = if ($script:language -eq 2052) { '正在安装知远智能体' } else { 'Installing ZhiYuan Agent' }
  $null = Wait-Until {
    [ZhiYuan.Acceptance.InstallerUi]::HasBrandedProgress($script:wizard.Handle, $expectedTitle)
  } 'real branded installation progress' $TimeoutSeconds
  Save-Page "$Name-progress"
  # Never click Next here. The completed progress page must advance itself;
  # doing so in the driver would hide the exact missing-finish regression.
  $close = Wait-Until {
    $button = Get-Button -Label '^(完成|Finish)$'
    $launch = Get-Button -Label '^(启动知远智能体|啟動知遠智能體|Launch ZhiYuan Agent)$'
    if ($button -and $button.Enabled -and $launch -and $launch.Enabled) { return $button }
  } 'automatic transition from progress to actionable finish page' $TimeoutSeconds
  [ZhiYuan.Acceptance.InstallerUi]::AssertProgressRemoved($script:wizard.Handle)
  $launch = Get-Button -Label '^(启动知远智能体|啟動知遠智能體|Launch ZhiYuan Agent)$'
  $expectedLaunch = if ($script:language -eq 2052) { '启动知远智能体' } else { 'Launch ZhiYuan Agent' }
  if ((Normalize-Label $launch.Text) -ne $expectedLaunch) { throw 'Finish page language differs from the selected language' }
  foreach ($control in @($close, $launch)) {
    [ZhiYuan.Acceptance.InstallerUi]::AssertActionLayout($script:wizard.Handle, $control.Handle, $actionFont.Family, $actionFont.Points, $actionFont.ButtonWeight)
  }
  if ($close.Left -lt ($launch.Left + $launch.Width) -and
      $launch.Left -lt ($close.Left + $close.Width) -and
      $close.Top -lt ($launch.Top + $launch.Height) -and
      $launch.Top -lt ($close.Top + $close.Height)) { throw 'Finish actions overlap' }
  Save-Page "$Name-finish"
}

function Wait-InstallerExit {
  param([System.Diagnostics.Process]$Process, [switch]$Cancelled)
  if (-not $Process.WaitForExit(60000)) { throw 'Installer did not exit after its visible completion/cancel action' }
  if (-not $Cancelled -and $Process.ExitCode -ne 0) { throw "Installer exited with $($Process.ExitCode)" }
  $null = Wait-Until { if (@(Get-InstallerWindows).Count -eq 0) { return $true } } 'installer windows to close'
}

function Get-AppProcesses {
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $app })
}

function Wait-AppWindow {
  Wait-Until {
    $ids = @(Get-AppProcesses | ForEach-Object { [int]$_.ProcessId })
    [ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object {
      $_.ProcessId -in $ids -and $_.ClassName -eq 'Chrome_WidgetWin_1' -and $_.Width -gt 200 -and $_.Height -gt 200
    } | Select-Object -First 1
  } 'the exact installed application window' 120
}

function Get-RegistrationSnapshot {
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) { throw 'Expected one installed uninstaller for registration verification' }
  # Windows PowerShell's .NET Framework expands 8.3 paths in FileInfo.FullName.
  # Registry strings can retain RUNNER~1 or another valid short path, so compare
  # fully qualified paths on both sides rather than raw command prefixes.
  $expectedUninstaller = [IO.Path]::GetFullPath($uninstallers[0].FullName)
  $expectedInstallRoot = [IO.Path]::GetFullPath($installRoot).TrimEnd('\')
  $entries = foreach ($hive in @('HKCU', 'HKLM')) {
    foreach ($suffix in @('SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall', 'SOFTWARE/WOW6432Node/Microsoft/Windows/CurrentVersion/Uninstall')) {
      $key = "${hive}:/$suffix"
      foreach ($item in @(Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue)) {
        $value = Get-ItemProperty -LiteralPath $item.PSPath
        # electron-builder writes InstallLocation to Software\APP_GUID, not
        # to its separate Windows Uninstall entry. Bind the latter to the
        # exact installed uninstaller, then inspect both registration keys.
        if (-not $value.PSObject.Properties['UninstallString']) { continue }
        $uninstallCommand = [string]$value.UninstallString
        if ($uninstallCommand -notmatch '^"([^"\r\n]+)"(?:\s|$)') { continue }
        $registeredUninstaller = $Matches[1]
        if (-not [IO.Path]::IsPathRooted($registeredUninstaller) -or
            -not (Test-Path -LiteralPath $registeredUninstaller -PathType Leaf)) { continue }
        $registeredUninstaller = [IO.Path]::GetFullPath($registeredUninstaller)
        if ($registeredUninstaller.Equals($expectedUninstaller, [StringComparison]::OrdinalIgnoreCase)) {
          $software = if ($suffix -like '*WOW6432Node*') { 'SOFTWARE/WOW6432Node' } else { 'SOFTWARE' }
          $installKey = "${hive}:/$software/$($item.PSChildName)"
          $installValue = Get-ItemProperty -LiteralPath $installKey
          if (-not $installValue.PSObject.Properties['InstallLocation'] -or
              -not (Test-Path -LiteralPath $installValue.InstallLocation -PathType Container) -or
              -not ([IO.Path]::GetFullPath($installValue.InstallLocation).TrimEnd('\')).Equals($expectedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Installer location registration does not match the installed bytes: $installKey"
          }
          $uninstallValues = [ordered]@{}
          $installValues = [ordered]@{}
          foreach ($name in @($item.GetValueNames() | Sort-Object)) {
            $uninstallValues[$name] = [ordered]@{ kind = $item.GetValueKind($name).ToString(); value = $item.GetValue($name) }
          }
          $installItem = Get-Item -LiteralPath $installKey
          foreach ($name in @($installItem.GetValueNames() | Sort-Object)) {
            $installValues[$name] = [ordered]@{ kind = $installItem.GetValueKind($name).ToString(); value = $installItem.GetValue($name) }
          }
          [ordered]@{ path = $item.Name; installPath = $installItem.Name; uninstallValues = $uninstallValues; installValues = $installValues }
        }
      }
    }
  }
  @($entries | Sort-Object { $_.path }) | ConvertTo-Json -Depth 8 -Compress
}

function Get-InstallDirectorySnapshot {
  $prefix = (Split-Path $installRoot -Leaf) + '.old.'
  $backups = foreach ($directory in @(Get-ChildItem -LiteralPath (Split-Path $installRoot) -Directory -Force)) {
    if (-not $directory.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
    # A previously detached backup may disappear during its asynchronous
    # cleanup. Only missing-path errors are allowed; access failures still fail.
    $identity = [ZhiYuan.Acceptance.InstallerUi]::DirectoryIdentity($directory.FullName, $true)
    if ($identity) { [pscustomobject]@{ path = $directory.FullName; identity = $identity } }
  }
  [pscustomobject]@{
    path = [IO.Path]::GetFullPath($installRoot)
    identity = [ZhiYuan.Acceptance.InstallerUi]::DirectoryIdentity($installRoot, $true)
    backups = @($backups | Sort-Object path)
  }
}

function Assert-CancelDirectoryPreserved {
  param($Before, $After)
  if (-not $Before.identity -or $Before.identity -ne $After.identity) {
    throw 'Cancelling setup detached the existing installation (directory identity changed or disappeared)'
  }
  foreach ($backup in $After.backups) {
    $previous = @($Before.backups | Where-Object {
      $_.path.Equals($backup.path, [StringComparison]::OrdinalIgnoreCase) -and $_.identity -eq $backup.identity
    })
    if ($previous.Count -ne 1) {
      throw "Cancelling setup created or replaced an installation backup: $($backup.path)"
    }
  }
  # Old backup removal is normal background cleanup, not cancellation damage.
  # An unchanged installed-directory file ID and no new backup objects prove
  # cancellation did not detach/replace it, even if its bytes were identical.
}

function Stop-AcceptanceProcess {
  param([int]$ProcessId)
  # A previous /T may already have removed this PID. Start-Process keeps a
  # benign native stderr race from becoming a terminating PS 5.1 error that
  # overwrites the original acceptance failure.
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
  $killer = Start-Process -FilePath "$env:SystemRoot/System32/taskkill.exe" -ArgumentList @('/PID', "$ProcessId", '/T', '/F') -PassThru -WindowStyle Hidden
  if (-not $killer.WaitForExit(10000)) {
    Stop-Process -Id $killer.Id -Force -ErrorAction SilentlyContinue
    Write-Warning "Cleanup timed out for acceptance process $ProcessId"
  } elseif ($killer.ExitCode -ne 0 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    Write-Warning "Cleanup could not stop acceptance process $ProcessId (exit $($killer.ExitCode))"
  }
}

try {
  $process = Start-Installer -Language 2052
  Begin-Installation 'fresh'
  Wait-ForProgressAndFinish 'fresh'
  if (-not (Test-Path -LiteralPath $app)) { throw 'Interactive installation did not produce the application executable' }
  [ZhiYuan.Acceptance.InstallerUi]::Click((Get-Button -Label '^(完成|Finish)$').Handle)
  Wait-InstallerExit $process
  if (@(Get-AppProcesses).Count) { throw 'Close unexpectedly launched the application' }
  $report.checks.freshInstall = $true
  $report.checks.closeWithoutLaunch = $true

  # Real existing-install cancel safety: the running application, bytes and
  # registration must survive opening and cancelling another setup wizard.
  $null = Start-Process -FilePath $app -PassThru
  $runningWindow = Wait-AppWindow
  $runningApp = Get-Process -Id $runningWindow.ProcessId
  $exeHash = (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash
  $asar = Join-Path $installRoot 'resources/app.asar'
  $asarHash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
  $registryBefore = Get-RegistrationSnapshot
  if (-not $registryBefore) { throw 'No installation registration found to verify cancellation safety' }
  $report.cancelDirectoryBefore = Get-InstallDirectorySnapshot
  if (-not $report.cancelDirectoryBefore.identity) { throw 'The existing installation directory is missing before cancellation' }
  $process = Start-Installer -Language 1033
  Save-Page 'existing-install-before-cancel'
  [ZhiYuan.Acceptance.InstallerUi]::Click((Get-Button -Label '^(取消|Cancel)$').Handle)
  $null = Wait-Until {
    if ($process.HasExited) { return $true }
    foreach ($window in (Get-InstallerWindows)) {
      if ($window.Handle -eq $script:wizard.Handle) { continue }
      $yes = Get-Button -Id 6 -Window $window.Handle
      if ($yes -and $yes.Enabled) {
        Save-Page 'cancel-confirmation' $window.Handle
        [ZhiYuan.Acceptance.InstallerUi]::Click($yes.Handle)
        return $true
      }
    }
  } 'cancellation or its real confirmation dialog'
  Wait-InstallerExit $process -Cancelled
  $report.cancelDirectoryAfter = Get-InstallDirectorySnapshot
  Assert-CancelDirectoryPreserved $report.cancelDirectoryBefore $report.cancelDirectoryAfter
  $runningApp.Refresh()
  if ($runningApp.HasExited) { throw 'Opening/cancelling setup terminated the existing application' }
  if ((Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash -ne $exeHash -or
      (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne $asarHash) {
    throw 'Cancelling setup changed the existing installation bytes'
  }
  if ((Get-RegistrationSnapshot) -ne $registryBefore) { throw 'Cancelling setup changed the existing installation registration' }
  $report.checks.cancelPreservesRunningInstallation = $true

  # Reproduce a genuine sharing violation, with the handle owned by this
  # driver (outside INSTDIR), so StopAppProcesses cannot remove the obstacle.
  $fileLock = [IO.File]::Open($app, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $process = Start-Installer -Language 1033
  Begin-Installation 'recovery'
  $retryDialog = Wait-Until {
    foreach ($window in (Get-InstallerWindows)) {
      if ($window.Handle -eq $script:wizard.Handle) { continue }
      $retry = Get-Button -Id 4 -Window $window.Handle
      $cancel = Get-Button -Id 2 -Window $window.Handle
      if ($retry -and $retry.Enabled -and $cancel -and $cancel.Enabled) { return $window }
    }
  } 'recoverable locked-directory Retry/Cancel dialog' 120
  Save-Page 'recovery-locked-directory' $retryDialog.Handle
  if (-not (Test-Path -LiteralPath $app)) { throw 'Failed detach removed the existing executable' }
  $runningApp.Refresh()
  if (-not $runningApp.HasExited) { throw 'Committed reinstall did not stop the existing application before retry' }
  $fileLock.Dispose()
  $fileLock = $null
  [ZhiYuan.Acceptance.InstallerUi]::Click((Get-Button -Id 4 -Window $retryDialog.Handle).Handle)
  Wait-ForProgressAndFinish 'recovery'
  $report.checks.lockedDirectoryRetry = $true
  # Exercise the real launch failure path without a test-only installer hook.
  # The only moved file is this runner's freshly installed executable.
  Move-Item -LiteralPath $app -Destination $launchBackup
  [ZhiYuan.Acceptance.InstallerUi]::Click((Get-Button -Label '^(启动知远智能体|啟動知遠智能體|Launch ZhiYuan Agent)$').Handle)
  $launchErrorPattern = '\AThe app could not be started\. Retry, or close setup and use the Start menu\.\z'
  $launchError = Wait-Until {
    foreach ($window in (Get-InstallerWindows)) {
      if ($window.Handle -eq $script:wizard.Handle) { continue }
      $ok = [ZhiYuan.Acceptance.InstallerUi]::FindDialogAcknowledgement($window.Handle, $script:wizard.ProcessId, $script:wizard.Text, $launchErrorPattern, $script:wizard.Handle)
      if ($ok) { return $window }
    }
  } 'real failed-launch error dialog'
  Save-Page 'finish-launch-error' $launchError.Handle
  [ZhiYuan.Acceptance.InstallerUi]::ClickDialogAcknowledgement($launchError.Handle, $script:wizard.ProcessId, $script:wizard.Text, $launchErrorPattern, $script:wizard.Handle)
  $null = Wait-Until {
    $launch = Get-Button -Label '^Launch ZhiYuan Agent$'
    $close = Get-Button -Label '^Finish$'
    if ($launch -and $launch.Enabled -and $close -and $close.Enabled) { return $true }
  } 'usable finish page after launch failure'
  if ($process.HasExited) { throw 'Launch failure closed the installer instead of allowing recovery' }
  Move-Item -LiteralPath $launchBackup -Destination $app
  Save-Page 'finish-launch-recovered'
  $report.checks.launchFailureRecovery = $true
  [ZhiYuan.Acceptance.InstallerUi]::Click((Get-Button -Label '^(启动知远智能体|啟動知遠智能體|Launch ZhiYuan Agent)$').Handle)
  Wait-InstallerExit $process
  $launchedWindow = Wait-AppWindow
  Save-Page 'launched-installed-app' $launchedWindow.Handle
  $report.checks.finishLaunchesInstalledApplication = $true
  $report.checks.visibleActionsFitActualDpi = $true
  $report.checks.chineseAndEnglish = $true
  $report.passed = $true
} catch {
  $report.errors += $_.Exception.ToString()
  Write-Host "[InstallerInteractive] Acceptance failed: $($_.Exception.Message)"
  try {
    foreach ($window in (Get-InstallerWindows)) { Save-Page "failure-$($window.Handle)" $window.Handle }
  } catch { $report.errors += "Failure screenshot: $($_.Exception.Message)" }
  throw
} finally {
  if ($null -ne $fileLock) { $fileLock.Dispose() }
  if ((Test-Path -LiteralPath $launchBackup) -and -not (Test-Path -LiteralPath $app)) {
    Move-Item -LiteralPath $launchBackup -Destination $app
  }
  $report.elapsedSeconds = ((Get-Date) - $started).TotalSeconds
  $report | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $evidence 'report.json')
  # Exact CI-owned paths and tracked process trees only; no broad process-name
  # termination and no security policy changes.
  foreach ($item in (Get-AppProcesses)) {
    try { Stop-AcceptanceProcess $item.ProcessId } catch { Write-Warning "Application cleanup failed: $($_.Exception.Message)" }
  }
  foreach ($processId in $script:installerProcesses) {
    try { Stop-AcceptanceProcess $processId } catch { Write-Warning "Installer cleanup failed: $($_.Exception.Message)" }
  }
  # taskkill's status must not become the PowerShell script's success status.
  $global:LASTEXITCODE = 0
}
