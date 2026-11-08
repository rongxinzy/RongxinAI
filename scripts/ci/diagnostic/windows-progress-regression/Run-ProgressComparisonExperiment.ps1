#requires -Version 5.1
param(
  [ValidateSet('single-progress', 'bundle12-progress')]
  [string]$Experiment = 'single-progress',
  [int]$MaxSeconds = 120,
  [string]$Workspace = $env:GITHUB_WORKSPACE
)

$ErrorActionPreference = 'Stop'
$PackageRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = (Get-Location).Path
}

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$outDir = Join-Path $PackageRoot "out\\run-$runId"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Get-SafeEnvSnapshot {
  $deny = '(?i)(secret|token|key|password|credential|auth|private)'
  $snap = [ordered]@{}
  [Environment]::GetEnvironmentVariables('Process').GetEnumerator() |
    Sort-Object Name |
    ForEach-Object {
      if ($_.Key -match $deny) { $snap[$_.Key] = '<redacted>' }
      else { $snap[$_.Key] = [string]$_.Value }
    }
  return $snap
}

function Get-ToolchainMeta {
  $meta = [ordered]@{
    utc = (Get-Date).ToUniversalTime().ToString('o')
    sourceSha = '977abbf023dfb8cbb3cf998b1d4e09e66ec86655'
    experiment = $Experiment
    workspace = $Workspace
    checkoutHead = $null
    powershell = $null
    pwsh = $null
    node = $null
    bun = $null
    vitest = $null
  }
  try {
    $meta.checkoutHead = (& git -C $Workspace rev-parse HEAD 2>$null).Trim()
  } catch {}
  try {
    $meta.powershell = (& powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>$null).Trim()
  } catch {}
  try {
    $meta.pwsh = (& pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>$null).Trim()
  } catch {}
  try {
    $meta.node = (& node --version 2>$null).Trim()
  } catch {}
  try {
    $meta.bun = (& bun --version 2>$null).Trim()
  } catch {}
  try {
    $vitestPkg = Join-Path $Workspace 'node_modules\\vitest\\package.json'
    if (Test-Path $vitestPkg) {
      $meta.vitest = (Get-Content $vitestPkg -Raw | ConvertFrom-Json).version
    }
  } catch {}
  return $meta
}

function Get-DesktopMeta {
  $sessionId = $null
  try { $sessionId = (Get-Process -Id $PID).SessionId } catch {}
  $qwinsta = $null
  try { $qwinsta = (& query user 2>$null | Out-String).Trim() } catch {}
  [ordered]@{
    utc = (Get-Date).ToUniversalTime().ToString('o')
    hostname = $env:COMPUTERNAME
    user = $env:USERNAME
    sessionName = $env:SESSIONNAME
    sessionId = $sessionId
    osVersion = [Environment]::OSVersion.VersionString
    is64Bit = [Environment]::Is64BitOperatingSystem
    interactive = [Environment]::UserInteractive
    queryUser = $qwinsta
    preflightRun = '42340332484'
    githubJob = '128306426233'
  }
}

function Stop-FixtureProcesses {
  Get-Process -Name 'ProgressFixture' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Filter 'zhiyuan-progress-*' -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Invoke-RecordedArm {
  param(
    [string]$ArmId,
    [string]$Executable,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [hashtable]$ExtraEnv = @{}
  )
  $stdoutPath = Join-Path $outDir "$ArmId.stdout.log"
  $stderrPath = Join-Path $outDir "$ArmId.stderr.log"
  $summaryPath = Join-Path $outDir "$ArmId.summary.json"
  $envBackup = @{}
  foreach ($key in $ExtraEnv.Keys) {
    $envBackup[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    Set-Item -Path "Env:$key" -Value ([string]$ExtraEnv[$key])
  }
  $process = $null
  $armError = $null
  $exitCode = -1
  $exitCodeSource = 'process'
  $timedOut = $false
  try {
    $process = Start-Process -FilePath $Executable -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow -Wait `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $process.Refresh()
    if ($null -eq $process.ExitCode) { $exitCode = -999; $exitCodeSource = 'unavailable' }
    else { $exitCode = [int]$process.ExitCode }
  } catch {
    $armError = $_.Exception.Message
    $timedOut = $armError -match 'timeout'
    if ($null -ne $process) {
      $process.Refresh()
      if ($null -ne $process.ExitCode) { $exitCode = [int]$process.ExitCode }
    }
  } finally {
    foreach ($key in $ExtraEnv.Keys) {
      if ($null -eq $envBackup[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item -Path "Env:$key" -Value $envBackup[$key] }
    }
    Stop-FixtureProcesses
  }

  $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
  $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
  $passLine = ($stdout -match 'PASS: real page-scoped IDs distinguish hero, progress and finish')
  $passMismatch = ($exitCode -eq 0 -and -not $passLine) -or ($exitCode -ne 0 -and $passLine)

  $summary = [ordered]@{
    arm = $ArmId
    succeeded = ($exitCode -eq 0)
    exitCode = $exitCode
    exitCodeSource = $exitCodeSource
    timedOut = $timedOut
    error = $armError
    executable = $Executable
    argumentList = $ArgumentList
    workingDirectory = $WorkingDirectory
    envSnapshot = Get-SafeEnvSnapshot
    stdoutPassLine = [bool]$passLine
    passLineMismatch = $passMismatch
    stderrHas203 = ($stderr -match 'environment option that was entered|203|ERROR_ENVVAR_NOT_FOUND')
    stderrHasWin32Exception = ($stderr -match 'Win32Exception')
    vitestCollectionFailed = ($stderr -match 'Failed Suites|ENOENT.*windows-installer-interactive')
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
  }
  ($summary | ConvertTo-Json -Depth 8) | Out-File -FilePath $summaryPath -Encoding utf8
  return $summary
}

(Get-DesktopMeta | ConvertTo-Json -Depth 6) | Out-File -FilePath (Join-Path $outDir 'environment.json') -Encoding utf8
(Get-ToolchainMeta | ConvertTo-Json -Depth 6) | Out-File -FilePath (Join-Path $outDir 'toolchain.json') -Encoding utf8

$arms = @()
try {
  $arms += Invoke-RecordedArm -ArmId 'A-bare-package' -Executable 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PackageRoot 'original\\windows-installer-progress-regression.ps1')
  ) -WorkingDirectory (Join-Path $PackageRoot 'original')

  $arms += Invoke-RecordedArm -ArmId 'B-spawn-vitest-parity' -Executable 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $Workspace 'scripts\\ci\\windows-installer-progress-regression.ps1'),
    '-ProjectRoot', $Workspace
  ) -WorkingDirectory $Workspace

  if ($Experiment -eq 'bundle12-progress') {
    $bundle = @(
      'scripts/ci/windows-installer-size-smoke.test.ts',
      'scripts/ci/windows-installer-interactive.test.ts',
      'scripts/ci/windows-shell-interactive.test.ts',
      'scripts/ci/windows-shell-uninstall.test.ts',
      'scripts/installer-shell/app/engine-contracts.test.ts',
      'scripts/installer-shell/preview-ui.test.ts',
      'scripts/installer-shell/powershell-environment.test.ts',
      'scripts/installer/cleanup-after-install.test.ts',
      'scripts/installer/recover-component-switch.test.ts',
      'scripts/installer/migrate-user-skills.test.ts',
      'scripts/installer/validate-install-root.test.ts',
      'tests/nsis-installer.test.ts'
    )
    $vitestArgs = @('x', 'vitest', 'run', '--maxWorkers=1') + $bundle
    $arms += Invoke-RecordedArm -ArmId 'D-vitest-bundle12' -Executable 'bun' -ArgumentList $vitestArgs -WorkingDirectory $Workspace
  } else {
    $arms += Invoke-RecordedArm -ArmId 'C-vitest-single' -Executable 'bun' -ArgumentList @(
      'x', 'vitest', 'run', '--maxWorkers=1',
      '-t', 'distinguishes real cross-process page ID reuse and rejects visible or hidden progress residue',
      'scripts/ci/windows-installer-interactive.test.ts'
    ) -WorkingDirectory $Workspace
  }
} finally {
  Stop-FixtureProcesses
}

$reproduced = @($arms | Where-Object { -not $_.succeeded })
$report = [ordered]@{
  package = 'windows-progress-regression-comparison-round2'
  outDir = $outDir
  experiment = $Experiment
  arms = $arms
  anyFailure = ($reproduced.Count -gt 0)
  preflightFailureReproduced = @($arms | Where-Object {
    -not $_.succeeded -and ($_.stderrHas203 -or $_.stderrHasWin32Exception)
  }).Count -gt 0
  hypotheses = [ordered]@{
    H9_projectRoot = $(if ($arms[0].succeeded -and -not $arms[1].succeeded) { 'supported' } elseif ($arms[0].succeeded -and $arms[1].succeeded) { 'excluded-this-run' } else { 'inconclusive' })
    H5_vitestParent = $(if ($arms[-1].vitestCollectionFailed) { 'invalid-arm-orchestration' } elseif ($arms[1].succeeded -and -not $arms[-1].succeeded -and $arms[-1].stderrHas203) { 'supported' } elseif ($arms[-1].succeeded) { 'excluded-this-run' } elseif ($arms[1].succeeded -and $arms[-1].succeeded) { 'excluded-this-run' } else { 'inconclusive' })
  }
}
($report | ConvertTo-Json -Depth 10) | Out-File -FilePath (Join-Path $outDir 'comparison.report.json') -Encoding utf8
Write-Output "COMPARISON_REPORT=$($report | ConvertTo-Json -Compress -Depth 10)"
exit 0
