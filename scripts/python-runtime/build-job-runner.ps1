param([string]$Output = "$PSScriptRoot/../../resources/python-runtime/job-runner.exe")
$ErrorActionPreference = 'Stop'
$directory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$source = "$PSScriptRoot/job-runner.cpp"

function Import-VsDevEnvironment {
  if (Get-Command cl.exe -ErrorAction SilentlyContinue) { return $true }

  $vswhereCandidates = @(
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe' })
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($vswhere in $vswhereCandidates) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if (-not $installPath -and $arch -eq 'arm64') {
      $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath 2>$null
    }
    if (-not $installPath) {
      $installPath = & $vswhere -latest -products * -property installationPath 2>$null
    }
    if (-not $installPath) { continue }

    $vsDevCmd = Join-Path $installPath 'Common7\Tools\VsDevCmd.bat'
    if (Test-Path $vsDevCmd) {
      $cmdLine = "`"$vsDevCmd`" -no_logo -arch=$arch -host_arch=$arch >nul && set"
    } else {
      $vcvars = Join-Path $installPath 'VC\Auxiliary\Build\vcvarsall.bat'
      if (-not (Test-Path $vcvars)) { continue }
      $cmdLine = "`"$vcvars`" $arch >nul && set"
    }

    $envLines = & cmd.exe /d /s /c $cmdLine
    if ($LASTEXITCODE -ne 0) { continue }
    foreach ($line in $envLines) {
      $eqIndex = $line.IndexOf('=')
      if ($eqIndex -gt 0) {
        $name = $line.Substring(0, $eqIndex)
        $value = $line.Substring($eqIndex + 1)
        [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
      }
    }
    if (Get-Command cl.exe -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

if (Import-VsDevEnvironment) {
  & cl.exe /nologo /std:c++17 /EHsc /O2 /W4 /WX "$source" "/Fe:$Output" "/Fo:$directory/job-runner.obj"
  $compileExit = $LASTEXITCODE
  Remove-Item "$directory/job-runner.obj" -ErrorAction SilentlyContinue
  if ($compileExit -ne 0) { throw 'Unable to compile the Windows Job Object helper with cl.exe.' }
  exit 0
}

$clangCl = Get-Command clang-cl.exe -ErrorAction SilentlyContinue
if ($clangCl) {
  & $clangCl.Source /nologo /std:c++17 /EHsc /O2 /W4 /WX "$source" "/Fe:$Output" "/Fo:$directory/job-runner.obj"
  $compileExit = $LASTEXITCODE
  Remove-Item "$directory/job-runner.obj" -ErrorAction SilentlyContinue
  if ($compileExit -ne 0) { throw 'Unable to compile the Windows Job Object helper with clang-cl.exe.' }
  exit 0
}

foreach ($compilerName in @('clang++.exe', 'g++.exe')) {
  $compiler = Get-Command $compilerName -ErrorAction SilentlyContinue
  if ($compiler) {
    & $compiler.Source -std=c++17 -O2 -Wall -Wextra -Werror -municode -static "$source" -o "$Output"
    if ($LASTEXITCODE -ne 0) { throw "Unable to compile the Windows Job Object helper with $compilerName." }
    exit 0
  }
}

throw 'Unable to find a Windows C++ compiler (MSVC cl.exe via Visual Studio/Build Tools, clang-cl.exe, clang++.exe, or g++.exe) to compile resources/python-runtime/job-runner.exe. Install Visual Studio Build Tools with "Desktop development with C++" and retry.'
