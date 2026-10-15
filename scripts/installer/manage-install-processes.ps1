# Prefix-bounded process management. All paths arrive as literal -File args.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][int]$SelfPid,
  [Parameter(Mandatory = $true)][ValidateSet('stop', 'count')][string]$Mode
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$installPrefix = [IO.Path]::GetFullPath($InstallDir).TrimEnd([char]0x5c) + [char]0x5c
$runtimePrefix = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd([char]0x5c) + [char]0x5c
function Get-InstallProcesses([bool]$IncludeRuntime) {
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $image = $_.ExecutablePath
    $_.ProcessId -ne $SelfPid -and $image -and ($image.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      ($IncludeRuntime -and $image.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)))
  })
}
if ($Mode -eq 'count') {
  # The uninstaller can itself live inside the install directory.
  exit [Math]::Min(200, @(Get-InstallProcesses $false).Count)
}
$stopped = 0
foreach ($process in @(Get-InstallProcesses $true | Where-Object { $_.ProcessId -ne $SelfPid })) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  $stopped += 1
}
$remaining = @()
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = @(Get-InstallProcesses $true | Where-Object { $_.ProcessId -ne $SelfPid })
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
Write-Output "stopped=$stopped remaining=$($remaining.Count)"
if ($remaining.Count -gt 0) { exit 1 }
