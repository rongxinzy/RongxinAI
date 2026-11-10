param([Parameter(Mandatory = $true)][string]$ExpectedThumbprint)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$release = Join-Path $root 'release/defense'
$installers = @(Get-ChildItem $release -Filter 'ZhiYuanAgentDefense-Setup-*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one defense installer.' }
$installer = $installers[0]
$installRoot = Join-Path $env:ProgramFiles 'ZhiYuanAgentDefense'
$resources = Join-Path $installRoot 'resources'
$app = Join-Path $installRoot 'ZhiYuanAgentDefense.exe'
$appData = Join-Path $env:APPDATA 'ZhiYuanAgentDefense'
$python = Join-Path $resources 'python-win/python.exe'
$skillPython = Join-Path $resources 'skill-python/layers/shared/Scripts/python.exe'
$uv = Join-Path $resources 'uv-win/uv.exe'
$bash = Join-Path $resources 'mingit/bin/bash.exe'
$oldPath = $env:PATH
$node = (Get-Command node -CommandType Application).Source
$tmp = Join-Path $env:RUNNER_TEMP "defense-offline-$PID"
$rules = @()
$desktop = $null

function Assert-Signed([string]$File) {
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) {
    throw "Unexpected Authenticode signature for $File"
  }
}

function Block-ExecutableNetwork([string]$File, [string]$Name) {
  New-NetFirewallRule -Name $Name -DisplayName $Name -Direction Outbound -Action Block -Program $File |
    Out-Null
  $script:rules += $Name
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File exited with code $LASTEXITCODE" }
}

Assert-Signed $installer.FullName
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $appData)) {
  throw 'Defense installation smoke requires a fresh profile and installation directory.'
}

try {
  Block-ExecutableNetwork $installer.FullName "zhiyuan-defense-setup-$PID"
  $setup = Start-Process $installer.FullName -ArgumentList '/S' -PassThru -Wait
  if ($setup.ExitCode -ne 0) { throw "Defense installation failed ($($setup.ExitCode))." }
  Assert-Signed $app

  $env:ZHIYUAN_DEFENSE_INSTALLED_RESOURCES = $resources
  Push-Location $root
  try {
    node -e "const checks = require('./scripts/packaging/defense-edition.cjs'); const root = process.env.ZHIYUAN_DEFENSE_INSTALLED_RESOURCES; checks.verifyDefenseResources(root); checks.verifyDefenseAsar(root)"
    if ($LASTEXITCODE -ne 0) { throw 'Installed defense resource verification failed.' }
  } finally {
    Pop-Location
    Remove-Item Env:ZHIYUAN_DEFENSE_INSTALLED_RESOURCES
  }

  Block-ExecutableNetwork $app "zhiyuan-defense-app-$PID"
  Block-ExecutableNetwork $uv "zhiyuan-defense-uv-$PID"
  Block-ExecutableNetwork $python "zhiyuan-defense-python-$PID"
  Block-ExecutableNetwork $skillPython "zhiyuan-defense-skill-python-$PID"
  if (-not (Test-Path -LiteralPath $bash)) { $bash = Join-Path $resources 'mingit/usr/bin/bash.exe' }
  Block-ExecutableNetwork $bash "zhiyuan-defense-bash-$PID"
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  Invoke-Checked $bash @('-lc', 'git --version')
  $desktop = Start-Process $app -PassThru
  $database = Join-Path $appData 'zhiyuan.sqlite'
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    $desktop.Refresh()
    if ($desktop.HasExited) { throw "Defense application exited during first launch ($($desktop.ExitCode))." }
    if ($desktop.MainWindowHandle -ne [IntPtr]::Zero -and (Test-Path -LiteralPath $database)) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($desktop.MainWindowHandle -eq [IntPtr]::Zero -or -not (Test-Path -LiteralPath $database)) {
    throw 'Defense application did not show its first window and initialize its isolated database.'
  }

  Invoke-Checked $node @((Join-Path $PSScriptRoot 'windows-defense-python-smoke.cjs'), $app, $resources, $tmp)
  $imports = 'import pandas, openpyxl, docx, pptx, httpx'
  Invoke-Checked $skillPython @('-c', $imports)

  $hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($installer.Name)" | Set-Content (Join-Path $release 'SHA256SUMS.txt') -Encoding utf8NoBOM
} finally {
  $env:PATH = $oldPath
  if ($null -ne $desktop -and -not $desktop.HasExited) {
    Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($rule in $rules) { Remove-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
