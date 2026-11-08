#requires -Version 5.1
param(
  [ValidateSet('Both', 'Original', 'Diagnostic')]
  [string]$Mode = 'Both',
  [int]$MaxSeconds = 120
)

$ErrorActionPreference = 'Stop'
$PackageRoot = $PSScriptRoot
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$outDir = Join-Path $PackageRoot "out\\run-$runId"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Get-DesktopMeta {
  $sessionId = $null
  try { $sessionId = (Get-Process -Id $PID).SessionId } catch {}
  $qwinsta = $null
  try {
    $qwinsta = (& query user 2>$null | Out-String).Trim()
  } catch {}
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
    sourceSha = '977abbf023dfb8cbb3cf998b1d4e09e66ec86655'
    preflightRun = '42340332484'
    githubJob = '128306426233'
  }
}

function Stop-FixtureProcesses {
  Get-Process -Name 'ProgressFixture' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Filter 'zhiyuan-progress-*' -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Invoke-Variant {
  param(
    [string]$Name,
    [string]$ScriptPath,
    [string]$WorkingDirectory,
    [hashtable]$ExtraEnv = @{}
  )
  $stdoutPath = Join-Path $outDir "$Name.stdout.log"
  $stderrPath = Join-Path $outDir "$Name.stderr.log"
  $summaryPath = Join-Path $outDir "$Name.summary.json"
  $eventsPath = Join-Path $outDir "$Name.events.jsonl"
  $envBackup = @{}
  foreach ($key in $ExtraEnv.Keys) {
    $envBackup[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    Set-Item -Path "Env:$key" -Value ([string]$ExtraEnv[$key])
  }
  $process = $null
  try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath
    ) -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $deadline = [DateTime]::UtcNow.AddSeconds($MaxSeconds)
    while (-not $process.HasExited) {
      if ([DateTime]::UtcNow -gt $deadline) {
        try { $process.Kill() } catch {}
        throw "$Name exceeded ${MaxSeconds}s"
      }
      Start-Sleep -Milliseconds 200
    }
    $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
    $summary = [ordered]@{
      variant = $Name
      exitCode = $process.ExitCode
      timedOut = $false
      stdoutPath = $stdoutPath
      stderrPath = $stderrPath
      eventsPath = $(if ($Name -eq 'diagnostic') { $eventsPath } else { $null })
      passLine = ($stdout -match 'PASS:')
    }
    ($summary | ConvertTo-Json -Depth 6) | Out-File -FilePath $summaryPath -Encoding utf8
    return $summary
  } catch {
    $summary = [ordered]@{
      variant = $Name
      exitCode = -1
      timedOut = ($_.Exception.Message -match 'exceeded')
      error = $_.Exception.Message
      stdoutPath = $stdoutPath
      stderrPath = $stderrPath
    }
    ($summary | ConvertTo-Json -Depth 6) | Out-File -FilePath $summaryPath -Encoding utf8
    return $summary
  } finally {
    foreach ($key in $ExtraEnv.Keys) {
      if ($null -eq $envBackup[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item -Path "Env:$key" -Value $envBackup[$key] }
    }
    if ($null -ne $process -and -not $process.HasExited) {
      try { $process.Kill() } catch {}
    }
    Stop-FixtureProcesses
  }
}

$meta = Get-DesktopMeta
($meta | ConvertTo-Json -Depth 6) | Out-File -FilePath (Join-Path $outDir 'environment.json') -Encoding utf8

$results = @()
try {
  if ($Mode -in 'Original', 'Both') {
    $results += Invoke-Variant -Name 'original' -ScriptPath (Join-Path $PackageRoot 'original\\windows-installer-progress-regression.ps1') -WorkingDirectory (Join-Path $PackageRoot 'original')
  }
  if ($Mode -in 'Diagnostic', 'Both') {
    $eventsPath = Join-Path $outDir 'diagnostic.events.jsonl'
    if (Test-Path $eventsPath) { Remove-Item $eventsPath -Force }
    $results += Invoke-Variant -Name 'diagnostic' -ScriptPath (Join-Path $PackageRoot 'diagnostic\\windows-installer-progress-regression-diagnostic.ps1') -WorkingDirectory (Join-Path $PackageRoot 'diagnostic') -ExtraEnv @{ ZH_PROGRESS_DIAG_LOG = $eventsPath }
  }
}
finally {
  Stop-FixtureProcesses
}

$report = [ordered]@{
  package = 'windows-progress-regression-diagnostic-977abbf02'
  outDir = $outDir
  mode = $Mode
  maxSeconds = $MaxSeconds
  results = $results
}
($report | ConvertTo-Json -Depth 8) | Out-File -FilePath (Join-Path $outDir 'report.json') -Encoding utf8
Write-Output "DIAG_REPORT=$($report | ConvertTo-Json -Compress -Depth 8)"
$failed = @($results | Where-Object {
    if ($_.passLine -eq $true) { return $false }
    if ($null -ne $_.exitCode) { return $_.exitCode -ne 0 }
    return $true
  })
if ($failed.Count -gt 0) { exit 1 }
exit 0
