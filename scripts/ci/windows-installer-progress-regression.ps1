param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Join-Path ([IO.Path]::GetTempPath()) ('zhiyuan-progress-' + [guid]::NewGuid().ToString('n'))
$child = $null

function Wait-Fixture {
  param([scriptblock]$Check, [string]$Label)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $value = & $Check
    if ($value) { return $value }
    if ($child.HasExited) { throw "Progress fixture exited early: $($child.get_ExitCode())" }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for real fixture $Label"
}

function Assert-RemovalResult {
  param([long]$Window, [bool]$ExpectedRejection)
  $rejected = $false
  try {
    [ZhiYuan.Acceptance.InstallerUi]::AssertProgressRemoved($Window)
  } catch {
    if ($_.Exception.ToString() -notmatch 'Wizard-owned progress controls were not destroyed:') { throw }
    $rejected = $true
  }
  if ($rejected -ne $ExpectedRejection) { throw "Incorrect progress destruction result: rejected=$rejected expected=$ExpectedRejection" }
}

try {
  [IO.Directory]::CreateDirectory($root) | Out-Null
  Add-Type -AssemblyName System.Drawing
  Add-Type -Path (Join-Path $ProjectRoot 'scripts/ci/windows-installer-ui.cs') -ReferencedAssemblies System,System.Core,System.Drawing
  $executable = Join-Path $root 'ProgressFixture.exe'
  $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
  try {
    $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
    $parameters.GenerateExecutable = $true
    $parameters.GenerateInMemory = $false
    $parameters.OutputAssembly = $executable
    foreach ($reference in @('System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll')) { $null = $parameters.ReferencedAssemblies.Add($reference) }
    $compiled = $provider.CompileAssemblyFromFile($parameters, (Join-Path $ProjectRoot 'scripts/ci/windows-installer-progress-fixture.cs'))
    if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
  } finally { $provider.Dispose() }

  foreach ($mode in @('clean', 'visible-residue', 'hidden-residue', 'incomplete', 'wrong-title')) {
    $child = New-Object System.Diagnostics.Process
    try {
      $child.StartInfo.FileName = $executable
      $child.StartInfo.Arguments = $mode
      $child.StartInfo.UseShellExecute = $false
      if (-not $child.Start()) { throw 'Real progress fixture did not start' }
      $null = $child.Handle
      $window = Wait-Fixture {
        $windows = @([ZhiYuan.Acceptance.InstallerUi]::Windows() | Where-Object { $_.ProcessId -eq $child.Id -and $_.Text -eq 'ZhiYuan progress ownership fixture' })
        if ($windows.Count -eq 1) { return $windows[0] }
      } 'window'
      if ($window.ProcessId -eq $PID) { throw 'Fixture must run in a separate process' }
      $advance = Wait-Fixture {
        [ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle) | Where-Object { $_.Visible -and $_.Text -eq 'Advance fixture' }
      } 'hero controls'
      if ($advance.ClassName -ne 'Button' -or -not $advance.Enabled -or $advance.ParentHandle -ne $window.Handle -or $advance.ControlId -ne 1100) {
        throw "Expected enabled native fixture Button owned by wizard: $($advance | ConvertTo-Json -Compress)"
      }
      $heroIds = @([ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle) | Where-Object { $_.ControlId -ge 1200 -and $_.ControlId -le 1206 })
      if ($heroIds.Count -ne 7) { throw 'Fixture must reproduce all seven reused hero IDs' }
      if ([ZhiYuan.Acceptance.InstallerUi]::HasBrandedProgress($window.Handle, 'Installing ZhiYuan Agent')) { throw 'Hero IDs were mistaken for branded progress' }
      Assert-RemovalResult $window.Handle $false

      [ZhiYuan.Acceptance.InstallerUi]::Click($advance.Handle)
      $finish = Wait-Fixture {
        [ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle) | Where-Object { $_.Visible -and $_.Text -eq 'Finish fixture' }
      } 'progress controls'
      $expectedProgress = $mode -notin @('incomplete', 'wrong-title')
      $hasProgress = [ZhiYuan.Acceptance.InstallerUi]::HasBrandedProgress($window.Handle, 'Installing ZhiYuan Agent')
      if ($hasProgress -ne $expectedProgress) { throw "Incorrect real progress recognition for $mode" }
      if ([ZhiYuan.Acceptance.InstallerUi]::HasBrandedProgress($window.Handle, 'Wrong language title')) { throw 'Wrong progress language was accepted' }
      Assert-RemovalResult $window.Handle $true

      [ZhiYuan.Acceptance.InstallerUi]::Click($finish.Handle)
      $null = Wait-Fixture {
        [ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle) | Where-Object { $_.Visible -and $_.Text -eq 'Fixture finished' }
      } 'finish controls'
      $finishIds = @([ZhiYuan.Acceptance.InstallerUi]::Controls($window.Handle) | Where-Object { $_.ParentHandle -ne $window.Handle -and $_.ControlId -ge 1200 -and $_.ControlId -le 1203 })
      if ($finishIds.Count -ne 4) { throw 'Fixture must reproduce the four reused finish IDs' }
      if ([ZhiYuan.Acceptance.InstallerUi]::HasBrandedProgress($window.Handle, 'Installing ZhiYuan Agent')) { throw 'Finish IDs were mistaken for branded progress' }
      $expectedResidue = $mode -in @('visible-residue', 'hidden-residue')
      Assert-RemovalResult $window.Handle $expectedResidue
      if ($expectedResidue) {
        $residue = @([ZhiYuan.Acceptance.InstallerUi]::ProgressControls($window.Handle))
        if ($residue.Count -ne 1 -or $residue[0].Visible -ne ($mode -eq 'visible-residue')) { throw 'Fixture residue visibility differs from the required negative case' }
      }
    } finally {
      if ($null -ne $child) {
        if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(5000) }
        $child.Dispose()
        $child = $null
      }
    }
  }
  Write-Output 'PASS: real page-scoped IDs distinguish hero, progress and finish; visible and hidden progress residue fail'
} finally {
  if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) }
}
