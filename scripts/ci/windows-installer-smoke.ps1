param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing ${Label}: $Path"
  }
}

function Invoke-Installer {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Label = 'installer',
    [int]$TimeoutSeconds = 2700,
    [string]$DiagnosticLogPath = ''
  )

  Write-Host "[WindowsInstallerSmoke] Starting $Label (timeout: ${TimeoutSeconds}s)"
  $startedAt = Get-Date
  $process = Start-Process -FilePath $Path -ArgumentList @('/S') -PassThru
  $lastDiagnostic = ''
  while (-not $process.WaitForExit(10000)) {
    $elapsedSeconds = [int]((Get-Date) - $startedAt).TotalSeconds
    if ($DiagnosticLogPath -and $elapsedSeconds % 60 -lt 10 -and (Test-Path -LiteralPath $DiagnosticLogPath)) {
      $diagnostic = (Get-Content -LiteralPath $DiagnosticLogPath -Tail 6 -Encoding UTF8) -join "`n"
      if ($diagnostic -and $diagnostic -ne $lastDiagnostic) {
        Write-Host "[WindowsInstallerSmoke] $Label progress after ${elapsedSeconds}s:`n$diagnostic"
        $lastDiagnostic = $diagnostic
      }
    }
    if ($elapsedSeconds -ge $TimeoutSeconds) {
      Write-Host "[WindowsInstallerSmoke] $Label process tree before timeout termination:"
      $allProcesses = @(Get-CimInstance Win32_Process)
      $processIds = @([uint32]$process.Id)
      do {
        $children = @($allProcesses | Where-Object {
          $_.ParentProcessId -in $processIds -and $_.ProcessId -notin $processIds
        })
        $newIds = @($children | ForEach-Object { [uint32]$_.ProcessId })
        $processIds += $newIds
      } while ($newIds.Count -gt 0)
      $allProcesses | Where-Object { $_.ProcessId -in $processIds } |
        Select-Object ProcessId, ParentProcessId, Name, CommandLine |
        Format-Table -Wrap | Out-String | Write-Host
      if ($DiagnosticLogPath -and (Test-Path -LiteralPath $DiagnosticLogPath)) {
        Write-Host "[WindowsInstallerSmoke] Complete installer timing log:"
        Get-Content -LiteralPath $DiagnosticLogPath -Encoding UTF8 | Out-Host
      }
      & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Host
      throw "$Label timed out after $TimeoutSeconds seconds"
    }
  }
  if ($process.ExitCode -ne 0) {
    throw "$Label failed with exit code $($process.ExitCode)"
  }
  $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  Write-Host "[WindowsInstallerSmoke] Completed $Label in ${elapsed}s"
}

function Wait-ForUninstallCompletion {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$RuntimeRoot,
    [int]$TimeoutSeconds = 300
  )

  Write-Host "[WindowsInstallerSmoke] Waiting for the spawned background uninstaller (timeout: ${TimeoutSeconds}s)"
  $startedAt = Get-Date
  $lastProgressAt = -30
  while ((Test-Path -LiteralPath $InstallRoot) -or (Test-Path -LiteralPath $RuntimeRoot)) {
    $elapsedSeconds = [int]((Get-Date) - $startedAt).TotalSeconds
    if ($elapsedSeconds - $lastProgressAt -ge 30) {
      Write-Host "[WindowsInstallerSmoke] Background uninstall progress after ${elapsedSeconds}s: installRoot=$([bool](Test-Path -LiteralPath $InstallRoot)) runtimeRoot=$([bool](Test-Path -LiteralPath $RuntimeRoot))"
      $lastProgressAt = $elapsedSeconds
    }
    if ($elapsedSeconds -ge $TimeoutSeconds) {
      Write-Host '[WindowsInstallerSmoke] Uninstaller processes before timeout:'
      Get-CimInstance Win32_Process | Where-Object {
        $_.Name -like 'Uninstall*.exe' -or $_.Name -like 'Un_*.exe' -or
        $_.CommandLine -like '*ZhiYuanAgent*' -or $_.CommandLine -like '*zhiyuan-agent*'
      } | Select-Object ProcessId, ParentProcessId, Name, CommandLine |
        Format-Table -Wrap | Out-String | Write-Host
      throw "Background uninstall did not remove the managed roots within $TimeoutSeconds seconds"
    }
    Start-Sleep -Seconds 2
  }
  $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  Write-Host "[WindowsInstallerSmoke] Completed background uninstall in ${elapsed}s"
}

$installers = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'release') -Filter '*.exe' -File |
  Where-Object { $_.Name -notlike '*Uninstall*' })
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows installer; found $($installers.Count)"
}

$installer = $installers[0].FullName
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\zhiyuan-agent'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'ZhiYuanAgent\runtimes'
$timingLog = Join-Path $env:APPDATA 'ZhiYuanAgent\install-timing.log'
$componentKeys = @('channel-runtime', 'skills', 'mcps', 'portable-git', 'python', 'skill-python', 'uv')

try {
  Invoke-Installer $installer 'cold installation' 2700 $timingLog
  Assert-Path $installRoot 'installation root'
  $applicationExecutables = @(Get-ChildItem -LiteralPath $installRoot -Filter '*.exe' -File |
    Where-Object { $_.Name -notlike 'Uninstall*' })
  if ($applicationExecutables.Count -ne 1) {
    throw "Expected exactly one installed application executable; found $($applicationExecutables.Count)"
  }
  Assert-Path $applicationExecutables[0].FullName 'installed application executable'
  Assert-Path $timingLog 'cold installation timing log'

  $coldLog = Get-Content -LiteralPath $timingLog -Raw -Encoding UTF8
  if (($coldLog | Select-String -AllMatches 'phase=component-cache-miss ').Matches.Count -ne 7) {
    throw 'Cold installation did not expand exactly seven offline components'
  }
  if ($coldLog -notmatch 'phase=install-complete .*component_set=ready') {
    throw 'Cold installation did not record a ready component set'
  }

  foreach ($key in $componentKeys) {
    $current = Join-Path (Join-Path $runtimeRoot $key) 'current'
    Assert-Path $current "active component pointer $key"
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
      throw "Component pointer is not a junction: $current"
    }
  }

  Invoke-Installer $installer 'cache-hit upgrade' 600 $timingLog
  Assert-Path $timingLog 'upgrade timing log'
  $upgradeLog = Get-Content -LiteralPath $timingLog -Raw -Encoding UTF8
  if (($upgradeLog | Select-String -AllMatches 'phase=component-cache-hit ').Matches.Count -ne 7) {
    throw 'Repeated installation did not reuse exactly seven offline components'
  }
  if ($upgradeLog -match 'phase=component-cache-miss ') {
    throw 'Repeated installation unexpectedly expanded an offline component'
  }
  if ($upgradeLog -notmatch 'phase=install-complete .*component_set=ready') {
    throw 'Repeated installation did not record a ready component set'
  }

  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File)
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one uninstaller; found $($uninstallers.Count)"
  }
  Invoke-Installer $uninstallers[0].FullName 'uninstall' 300 $timingLog
  # NSIS copies the uninstaller to a temporary Un_A process. The launcher can
  # exit before that process reaches customUnInstall, so wait for observable
  # completion instead of treating the launcher lifetime as the uninstall.
  Wait-ForUninstallCompletion $installRoot $runtimeRoot 300
} finally {
  if (Test-Path -LiteralPath $installRoot) {
    $remainingUninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
    if ($remainingUninstallers.Count -eq 1) {
      Start-Process -FilePath $remainingUninstallers[0].FullName -ArgumentList @('/S') -Wait | Out-Null
    }
  }
}
