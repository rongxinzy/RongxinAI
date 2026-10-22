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
$installRoot = [IO.Path]::GetFullPath($InstallDir).TrimEnd([char]0x5c)
$installPrefix = $installRoot + [char]0x5c
$runtimePrefix = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd([char]0x5c) + [char]0x5c
# Some processes report no ExecutablePath (protected/zoned); fall back to the
# names of the executables that ship inside the install directory.
$exeNames = @()
try {
  $exeNames = @(Get-ChildItem -LiteralPath $installRoot -Filter '*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Name })
} catch {
  $exeNames = @()
}
function Get-InstallProcesses([bool]$IncludeRuntime) {
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    if ($_.ProcessId -eq $SelfPid) { return $false }
    $image = $_.ExecutablePath
    if ($image) {
      return $image.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        ($IncludeRuntime -and $image.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase))
    }
    return [bool]($_.Name -and ($exeNames -contains $_.Name))
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
$forced = 0
if ($remaining.Count -gt 0) {
  foreach ($process in $remaining) {
    & taskkill.exe /F /T /PID $process.ProcessId 2>$null | Out-Null
    $forced += 1
  }
  Start-Sleep -Milliseconds 700
  $remaining = @(Get-InstallProcesses $true | Where-Object { $_.ProcessId -ne $SelfPid })
}
Write-Output "stopped=$stopped forced=$forced remaining=$($remaining.Count)"
if ($remaining.Count -gt 0) {
  Write-Output ("remaining_ids=" + (($remaining | ForEach-Object { "$($_.Name):$($_.ProcessId)" }) -join ','))
  exit 1
}
