param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$TarPath = ''
)

$ErrorActionPreference = 'Stop'

function Assert-Path {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing ${Label}: $Path"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$Label = $FilePath
  )
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Invoke-PackagedElectronChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$Label = $FilePath
  )
  # The packaged Electron binary is a Windows GUI executable even when
  # ELECTRON_RUN_AS_NODE is set. Start-Process -Wait provides deterministic
  # process-tree completion and an explicit exit code on Windows PowerShell 5.1.
  $quotedArguments = @($ArgumentList | ForEach-Object {
    if ($_ -match '"') {
      throw "$Label received an argument containing an unsupported double quote: $_"
    }
    '"' + $_ + '"'
  })
  $process = Start-Process -FilePath $FilePath -ArgumentList $quotedArguments `
    -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Label failed with exit code $($process.ExitCode)"
  }
}

$osVersion = [Environment]::OSVersion.Version
if ($osVersion.Major -ne 10) {
  throw "This gate requires a Windows 10/11-compatible host; detected $osVersion"
}

if (-not $TarPath) {
  $TarPath = Join-Path $ProjectRoot 'build-tar\win-resources.tar'
}
Assert-Path $TarPath 'Windows resource tar'

$systemTar = Join-Path $env:SystemRoot 'System32\tar.exe'
Assert-Path $systemTar 'Windows system tar.exe'

$smokeRoot = Join-Path $env:TEMP ("zhiyuan-runtime-smoke-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
$oldPath = $env:PATH
try {
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
  Invoke-Checked $systemTar @('-xf', $TarPath, '-C', $smokeRoot) 'Windows resource tar extraction'
  if (Test-Path -LiteralPath (Join-Path $smokeRoot 'llamacpp-backends')) {
    throw 'The offline core resource pack must not bundle llama.cpp backends'
  }
  if (Test-Path -LiteralPath (Join-Path $smokeRoot 'llamacpp-nsis-helper')) {
    throw 'The offline core resource pack must not bundle the retired NSIS llama.cpp helper'
  }

  $resourcesRoot = $smokeRoot
  $bash = Join-Path $resourcesRoot 'mingit\usr\bin\bash.exe'
  if (-not (Test-Path -LiteralPath $bash)) {
    $bash = Join-Path $resourcesRoot 'mingit\bin\bash.exe'
  }
  $python = Join-Path $resourcesRoot 'python-win\python.exe'
  $skillPython = Join-Path $resourcesRoot 'skill-python\xlsx\Scripts\python.exe'
  $pdfPython = Join-Path $resourcesRoot 'skill-python\pdf\Scripts\python.exe'
  $builderConfigPath = Join-Path $ProjectRoot 'electron-builder.json'
  Assert-Path $builderConfigPath 'electron-builder configuration'
  $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $appExecutableName = $builderConfig.executableName
  if (-not $appExecutableName) {
    $appExecutableName = $builderConfig.productName
  }
  if (-not $appExecutableName) {
    throw 'electron-builder.json must define executableName or productName'
  }
  # Exercise the packaged Electron binary instead of relying on the optional
  # node_modules Electron download that bun install --ignore-scripts omits.
  $electron = Join-Path $ProjectRoot ("release\win-unpacked\{0}.exe" -f $appExecutableName)
  $docxValidator = Join-Path $ProjectRoot 'scripts\ci\validate-docx-smoke.mjs'
  $skillsRoot = Join-Path $resourcesRoot 'SKILLs'

  Assert-Path $bash 'bundled PortableGit Bash'
  Assert-Path $python 'bundled application Python'
  Assert-Path $skillPython 'bundled XLSX Skill Python'
  Assert-Path $pdfPython 'bundled PDF Skill Python'
  Assert-Path $electron 'packaged Electron Node runtime'
  Assert-Path $docxValidator 'DOCX smoke validator'
  Assert-Path (Join-Path $resourcesRoot 'uv-win\uv.exe') 'bundled uv'
  Assert-Path (Join-Path $skillsRoot 'xlsx\scripts\xlsx_reader.py') 'XLSX Skill reader'
  Assert-Path (Join-Path $skillsRoot 'docx\scripts\markdown_to_docx.mjs') 'DOCX Markdown converter'

  # Remove Git, Python, Node, and user-installed tool directories from PATH.
  # The smoke test invokes only explicit package paths below.
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $env:UV_OFFLINE = '1'
  $env:ELECTRON_RUN_AS_NODE = '1'
  foreach ($externalCommand in @('git.exe', 'python.exe', 'python3.exe', 'node.exe')) {
    if (Get-Command $externalCommand -ErrorAction SilentlyContinue) {
      throw "External command unexpectedly remains discoverable on the clean PATH: $externalCommand"
    }
  }

  Invoke-Checked $python @('--version') 'bundled application Python version probe'
  # Windows PowerShell 5.1 strips nested quotes from native process arguments.
  # Keep these probes quote-free so the Python code is identical on clean CI hosts.
  Invoke-Checked $skillPython @('-c', 'import pandas, openpyxl; print(1)') 'bundled XLSX dependency probe'
  Invoke-Checked $pdfPython @('-c', 'import reportlab, pypdfium2, PIL; print(1)') 'bundled PDF dependency probe'
  Invoke-Checked $bash @('-lc', 'printf "portable-git-bash-ok\n"') 'bundled Bash probe'
  $markdown = Join-Path $smokeRoot 'smoke.md'
  $docx = Join-Path $smokeRoot 'smoke.docx'
  $converter = Join-Path $skillsRoot 'docx\scripts\markdown_to_docx.mjs'
  Set-Content -LiteralPath $markdown -Value "# Windows runtime smoke`n`nManaged DOCX conversion works.`n" -Encoding UTF8
  Invoke-PackagedElectronChecked $electron @($converter, $markdown, $docx) 'DOCX Markdown conversion'
  Assert-Path $docx 'generated DOCX'
  Invoke-PackagedElectronChecked $electron @($docxValidator, $docx) 'generated DOCX validation'
  $fixture = Join-Path $smokeRoot 'smoke.xlsx'
  $createFixture = "from openpyxl import Workbook; w=Workbook(); s=w.active; s.title='Smoke'; s.append(['Name','Score']); s.append(['Windows',100]); w.save(r'$fixture')"
  Invoke-Checked $skillPython @('-c', $createFixture) 'XLSX fixture creation'
  $reader = Join-Path $skillsRoot 'xlsx\scripts\xlsx_reader.py'
  Invoke-Checked $skillPython @($reader, $fixture, '--json') 'XLSX Skill reader'

  Write-Host "Windows runtime smoke passed on Windows $osVersion"
} finally {
  $env:PATH = $oldPath
  if (Test-Path -LiteralPath $smokeRoot) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force
  }
}
