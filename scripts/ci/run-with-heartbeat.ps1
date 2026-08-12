param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string[]]$ArgumentList,
  [ValidateRange(1, 240)][int]$TimeoutMinutes = 55,
  [ValidateRange(10, 300)][int]$HeartbeatSeconds = 60
)

$ErrorActionPreference = 'Stop'

$startedAt = Get-Date
$deadline = $startedAt.AddMinutes($TimeoutMinutes)
$logDirectory = Join-Path $env:RUNNER_TEMP 'zhiyuan-build-logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutPath = Join-Path $logDirectory 'installer-build.stdout.log'
$stderrPath = Join-Path $logDirectory 'installer-build.stderr.log'

function Write-RecentLog {
  param([string]$Path, [string]$Label)

  if (Test-Path -LiteralPath $Path) {
    $recent = Get-Content -LiteralPath $Path -Tail 30 -ErrorAction SilentlyContinue
    if ($recent) {
      Write-Host "--- $Label (last 30 lines) ---"
      $recent | ForEach-Object { Write-Host $_ }
    }
  }
}

Write-Host "Starting $FilePath $($ArgumentList -join ' ') with a $TimeoutMinutes minute limit."
$process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru `
  -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

try {
  while (-not $process.HasExited) {
    Start-Sleep -Seconds $HeartbeatSeconds
    $process.Refresh()
    if ($process.HasExited) { break }

    if ((Get-Date) -ge $deadline) {
      Write-Error "Installer build exceeded the $TimeoutMinutes minute limit; terminating process tree."
      & taskkill.exe /pid $process.Id /t /f | Write-Host
      $process.WaitForExit()
      Write-RecentLog -Path $stdoutPath -Label 'stdout after timeout'
      Write-RecentLog -Path $stderrPath -Label 'stderr after timeout'
      exit 1
    }

    $elapsed = [math]::Floor(((Get-Date) - $startedAt).TotalMinutes)
    Write-Host "Installer build is still running after $elapsed minute(s); process id=$($process.Id)."
    Write-RecentLog -Path $stdoutPath -Label 'stdout'
    Write-RecentLog -Path $stderrPath -Label 'stderr'
  }

  Write-RecentLog -Path $stdoutPath -Label 'stdout'
  Write-RecentLog -Path $stderrPath -Label 'stderr'
  if ($process.ExitCode -ne 0) {
    throw "Installer build exited with code $($process.ExitCode)."
  }
} finally {
  Write-Host "Build logs retained at $logDirectory"
}
