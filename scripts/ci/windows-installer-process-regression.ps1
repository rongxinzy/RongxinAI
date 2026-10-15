param([Parameter(Mandatory = $true)][string]$InstallerScriptPath)

# Parse and execute the production NSIS process helpers against real disposable
# executables. This catches invalid embedded PowerShell before a full package.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Get-Content -LiteralPath $InstallerScriptPath -Raw -Encoding UTF8
# CIM reports long executable paths; TEMP on hosted Windows may use RUNNER~1.
$tempRoot = [IO.Path]::GetFullPath((Get-Item -LiteralPath $env:TEMP).FullName)
$fixture = Join-Path $tempRoot ('zhiyuan-process-test-' + [guid]::NewGuid().ToString())
$installRoot = Join-Path $fixture ('Install [' + [char]0x5b89 + [char]0x88c5 + '] $literal `tick $(never)')
$localRoot = Join-Path $fixture 'LocalAppData'
$runtimeRoot = Join-Path $localRoot 'ZhiYuanAgent/runtimes'
$siblingRoot = "$installRoot-other"
$processes = @()

function Get-ProductionHelper {
  param([string]$Name, [string]$Mode)
  $macro = [regex]::Match($source, "(?s)!macro $Name\b(.*?)!macroend").Groups[1].Value
  if (-not $macro.Contains('-File "$PLUGINSDIR\manage-install-processes.ps1"') -or
      $macro -notmatch ('-Mode\s+' + [regex]::Escape($Mode) + '(?:\s|[\x22\x27])') -or
      -not $macro.Contains('-InstallDir "$INSTDIR"') -or
      -not $macro.Contains('-RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"') -or
      -not $macro.Contains('-SelfPid $9') -or $macro -match '-Command\b') {
    throw "Production $Name must pass literal paths to the shared -File helper"
  }
  $helper = Join-Path (Split-Path $InstallerScriptPath) 'installer/manage-install-processes.ps1'
  $parseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($helper, [ref]$null, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "Production $Name has invalid PowerShell: $($parseErrors | Out-String)" }
  return $helper
}

function Assert-NoErrorStream {
  param([string]$Text, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  # Windows PowerShell serializes first-use module progress to stderr. Ignore
  # only actual CLIXML progress records; plain stderr and error records fail.
  if ($Text -match '^#< CLIXML\s*') {
    try {
      [xml]$xml = $Text -replace '^#< CLIXML\s*', ''
      $records = @($xml.DocumentElement.ChildNodes | Where-Object NodeType -eq Element)
      if ($xml.DocumentElement.LocalName -eq 'Objs' -and $records.Count -gt 0 -and
          @($records | Where-Object { $_.GetAttribute('S') -ne 'progress' }).Count -eq 0) { return }
    } catch { }
  }
  throw "Production $Name failed: $Text"
}

function Invoke-ProductionHelper {
  param([string]$Name, [string]$Mode, [int]$ExcludedProcessId)
  $path = Get-ProductionHelper $Name $Mode
  $stdout = Join-Path $fixture "$Name.out"
  $stderr = Join-Path $fixture "$Name.err"
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $path + '" -Mode ' + $Mode + ' -InstallDir "' + $installRoot + '" -RuntimeRoot "' + $runtimeRoot + '" -SelfPid ' + $ExcludedProcessId
  $helper = Start-Process -FilePath "$PSHOME/powershell.exe" -ArgumentList $arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  try {
    if (-not $helper.WaitForExit(20000)) { throw "Production $Name timed out" }
    $errors = Get-Content -LiteralPath $stderr -Raw
    Assert-NoErrorStream $errors $Name
    [pscustomobject]@{ exitCode = $helper.ExitCode; output = (Get-Content -LiteralPath $stdout -Raw) }
  } finally {
    if (-not $helper.HasExited) { Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue }
  }
}

try {
  $null = Get-ProductionHelper 'StopAppProcesses' 'stop'
  $null = Get-ProductionHelper 'CountInstallDirProcesses' 'count'
  Assert-NoErrorStream '#< CLIXML
<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress"><MS><S N="Activity">Preparing modules for first use</S></MS></Obj></Objs>' 'progress fixture'
  foreach ($errorFixture in @('real native stderr', '#< CLIXML
<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="error">real error</S></Objs>')) {
    $rejected = $false
    try { Assert-NoErrorStream $errorFixture 'error fixture' } catch { $rejected = $true }
    if (-not $rejected) { throw 'A real error stream was ignored as progress' }
  }
  foreach ($directory in @($installRoot,$runtimeRoot,$siblingRoot)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
  $executable = Join-Path $installRoot 'app.exe'
  # Compile without loading the output into this harness, which would retain
  # an assembly file handle and interfere with the real process-only cleanup.
  Add-Type -AssemblyName Microsoft.CSharp
  $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
  try {
    $options = New-Object System.CodeDom.Compiler.CompilerParameters
    $options.GenerateExecutable = $true
    $options.OutputAssembly = $executable
    $compiled = $compiler.CompileAssemblyFromSource($options, 'public static class AcceptanceSleeper { public static void Main() { System.Threading.Thread.Sleep(60000); } }')
    if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
  } finally { $compiler.Dispose() }
  $paths = @($executable, (Join-Path $installRoot 'sidecar.exe'), (Join-Path $runtimeRoot 'runtime.exe'), (Join-Path $installRoot 'uninstaller.exe'), (Join-Path $siblingRoot 'app.exe'))
  foreach ($path in $paths) {
    if ($path -ne $executable) { Copy-Item -LiteralPath $executable -Destination $path }
    $processes += Start-Process -FilePath $path -WindowStyle Hidden -PassThru
  }
  $excluded = $processes[3].Id
  $countBefore = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $PID
  if ($countBefore.exitCode -ne 3) { throw "Expected three real processes under the Unicode install root, got $($countBefore.exitCode)" }
  $stopped = Invoke-ProductionHelper 'StopAppProcesses' 'stop' $excluded
  if ($stopped.exitCode -ne 0 -or $stopped.output -notmatch 'stopped=3 remaining=0') {
    throw "Production process stop did not report success: exit=$($stopped.exitCode) output=$($stopped.output)"
  }
  foreach ($process in $processes[0..2]) {
    if (-not $process.WaitForExit(5000)) { throw "Production helper did not stop app/sidecar/runtime process $($process.Id)" }
  }
  foreach ($process in $processes[3..4]) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Production helper killed the excluded installer or similarly named sibling installation' }
  }
  $countAfter = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $PID
  if ($countAfter.exitCode -ne 1) { throw 'The process counter did not retain the excluded installer at its actual path' }
  $countWithoutSelf = Invoke-ProductionHelper 'CountInstallDirProcesses' 'count' $excluded
  if ($countWithoutSelf.exitCode -ne 0) { throw 'The process counter did not exclude the current uninstaller' }
  Write-Output 'PASS: production NSIS commands parse and stop only real owned processes'
} finally {
  foreach ($process in $processes) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $null = $process.WaitForExit(5000)
    }
  }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
