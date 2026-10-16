param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path ([IO.Path]::GetTempPath()) ('zhiyuan-layout-' + [guid]::NewGuid().ToString('n'))
$child = $null
try {
  [IO.Directory]::CreateDirectory($root) | Out-Null
  $helper = Join-Path $ProjectRoot 'scripts/ci/windows-installer-ui.cs'
  Add-Type -AssemblyName System.Drawing
  Add-Type -Path $helper -ReferencedAssemblies System,System.Core,System.Drawing
  [ZhiYuan.Acceptance.InstallerUi]::UsePhysicalCoordinates()
  $font = [ZhiYuan.Acceptance.InstallerUi]::ReadActionFontContract((Join-Path $ProjectRoot 'scripts/installer-ui/zy-theme.nsh'))
  $executable = Join-Path $root 'LayoutFixture.exe'
  $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
  $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
  $parameters.GenerateExecutable = $true
  $parameters.GenerateInMemory = $false
  $parameters.OutputAssembly = $executable
  foreach ($reference in @('System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll')) { $null = $parameters.ReferencedAssemblies.Add($reference) }
  $compiled = $provider.CompileAssemblyFromFile($parameters, (Join-Path $ProjectRoot 'scripts/ci/windows-installer-layout-fixture.cs'))
  if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
  $provider.Dispose()
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo.FileName = $executable
  $child.StartInfo.Arguments = '"' + $font.Family + '" ' + $font.Points + ' ' + $font.BodyWeight + ' ' + $font.ButtonWeight
  $child.StartInfo.UseShellExecute = $false
  if (-not $child.Start()) { throw 'Real layout fixture did not start' }
  $null = $child.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $window = $null
  do {
    $windows = @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object { $_.ProcessId -eq $child.Id -and $_.Text -eq 'ZhiYuan cross-process layout fixture' })
    if ($windows.Count -eq 1) { $window = $windows[0]; break }
    if ($child.HasExited) { throw "Layout fixture exited early: $($child.get_ExitCode())" }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($null -eq $window -or $window.ProcessId -eq $PID) { throw 'No independent real fixture HWND appeared' }
  $controls = @([ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle))
  foreach ($id in 101..110) {
    $control = @($controls | Where-Object ControlId -eq $id)
    if ($control.Count -ne 1) { throw "Missing fixture control $id" }
    $points = if ($id -in @(106,107)) { $font.Points * 2 } else { $font.Points }
    $weight = if ($id -ge 108) { $font.ButtonWeight } else { $font.BodyWeight }
    $expectedRejection = $id -in @(102,103,105,107,110)
    $rejected = $false
    try {
      [ZhiYuan.Acceptance.InstallerUi]::AssertActionLayout($window.Handle, $control[0].Handle, $font.Family, $points, $weight)
    } catch {
      if ($_.Exception.ToString() -notmatch 'Action text does not fit at') { throw }
      $rejected = $true
      Write-Output "Correctly rejected clipped real control $id : $($_.Exception.Message)"
    }
    if ($rejected -ne $expectedRejection) { throw "Unexpected real layout result for $id : rejected=$rejected; font=$points/$weight; actualDpi=$($control[0].Dpi)" }
  }
  Write-Output 'PASS: cross-process Chinese and English action fonts fit; clipped width and height fail'
} finally {
  if ($null -ne $child) {
    if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(5000) }
    $child.Dispose()
  }
  if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) }
}
