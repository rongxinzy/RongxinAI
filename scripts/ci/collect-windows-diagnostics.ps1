param([string]$ProjectRoot = '', [string]$Label = 'workflow')

# Best effort only. Never replace the failing acceptance step's exit status.
$ErrorActionPreference = 'Stop'
try {
  if (-not $ProjectRoot) { $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')) }
  $destination = Join-Path $ProjectRoot "acceptance-diagnostics/nsis-$Label"
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $timing = Join-Path $env:APPDATA 'ZhiYuanAgent/install-timing.log'
  if (Test-Path -LiteralPath $timing) {
    # Bound output and retain the latest run even when upgrades append to the log.
    Get-Content -LiteralPath $timing -Tail 2000 -Encoding UTF8 |
      Set-Content -LiteralPath (Join-Path $destination 'install-timing.log') -Encoding UTF8
  }
  # Process names and IDs suffice for orphan diagnosis. Do not dump command lines or env.
  Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'processes.json') -Encoding UTF8
  @{
    label = $Label
    sourceCommit = $env:ZHIYUAN_SOURCE_COMMIT
    runId = $env:GITHUB_RUN_ID
    attempt = $env:GITHUB_RUN_ATTEMPT
    edition = $env:ZHIYUAN_UPDATE_VARIANT
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'context.json') -Encoding UTF8
} catch {
  Write-Warning "Unable to collect all Windows diagnostics: $_"
}
