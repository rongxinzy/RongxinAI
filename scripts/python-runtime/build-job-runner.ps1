param([string]$Output = "$PSScriptRoot/../../resources/python-runtime/job-runner.exe")
$ErrorActionPreference = 'Stop'
$directory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $directory | Out-Null
# Run inside the official MSVC developer environment (CI uses windows-latest).
& cl.exe /nologo /std:c++17 /EHsc /O2 /W4 /WX "$PSScriptRoot/job-runner.cpp" "/Fe:$Output" "/Fo:$directory/job-runner.obj"
if ($LASTEXITCODE -ne 0) { throw 'Unable to compile the Windows Job Object helper.' }
Remove-Item "$directory/job-runner.obj" -ErrorAction SilentlyContinue
