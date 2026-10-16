param(
  [ValidateSet('inspect', 'app', 'registration', 'hold-file')][string]$Action,
  [int]$TargetProcessId = 0,
  [string]$AppPath,
  [string]$Screenshot,
  [string]$WindowClass,
  [long]$WindowHandle = 0,
  [string]$ExpectedWindowTitle,
  [string]$AcknowledgeBodyPattern,
  [string]$FilePath,
  [string]$ReadyPath,
  [string]$ReleasePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if (-not $env:RUNNER_TEMP -or $env:OS -ne 'Windows_NT') { throw 'Disposable Windows runner required' }
if ($Action -eq 'hold-file') {
  $lock = [IO.File]::Open($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    [IO.File]::WriteAllText($ReadyPath, 'locked')
    $deadline = (Get-Date).AddMinutes(20)
    while (-not (Test-Path -LiteralPath $ReleasePath)) {
      if ((Get-Date) -gt $deadline) { throw 'Acceptance file lock exceeded 20 minutes' }
      Start-Sleep -Milliseconds 100
    }
  } finally { $lock.Dispose() }
  exit
}
if ($Action -eq 'registration') {
  $guid = '331369f7-5ab3-5702-935d-f3cff6ba8163'
  $result = foreach ($key in @("HKCU:/Software/$guid", "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$guid")) {
    if (Test-Path -LiteralPath $key) {
      $item = Get-Item -LiteralPath $key
      $values = [ordered]@{}
      foreach ($name in @($item.GetValueNames() | Sort-Object)) { $values[$name] = $item.GetValue($name) }
      [ordered]@{ key = $key; values = $values }
    }
  }
  ConvertTo-Json -InputObject @($result) -Depth 8 -Compress
  exit
}
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'windows-installer-ui.cs') -ReferencedAssemblies System,System.Core,System.Drawing
[ZhiYuan.Acceptance.InstallerUi]::UsePhysicalCoordinates()
$ids = @($TargetProcessId)
if ($Action -eq 'app') {
  $ids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $AppPath } | ForEach-Object { [int]$_.ProcessId })
}
$windows = @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object {
  $_.ProcessId -in $ids -and (-not $WindowClass -or $_.ClassName -eq $WindowClass) -and
    (-not $WindowHandle -or $_.Handle -eq $WindowHandle)
})
if ($Screenshot -and $windows.Count -ne 1) { throw "Expected one visible target window for capture; found $($windows.Count)" }
if ($AcknowledgeBodyPattern -and ($Action -ne 'inspect' -or $TargetProcessId -le 0 -or
    $WindowHandle -le 0 -or $WindowClass -ne '#32770' -or -not $ExpectedWindowTitle -or $windows.Count -ne 1)) {
  throw 'Native acknowledgement requires one exact process, dialog handle, title and expected body'
}
$result = foreach ($window in $windows) {
  $controls = @([ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle))
  if ($Screenshot) { [ZhiYuan.Acceptance.InstallerUi]::Capture($window.Handle, $Screenshot) }
  if ($AcknowledgeBodyPattern) {
    [ZhiYuan.Acceptance.InstallerUi]::ClickDialogAcknowledgement(
      $window.Handle, $TargetProcessId, $ExpectedWindowTitle, $AcknowledgeBodyPattern, 0)
  }
  [ordered]@{ window = $window; controls = $controls }
}
[ordered]@{ processIds = $ids; windows = @($result) } | ConvertTo-Json -Depth 8 -Compress
