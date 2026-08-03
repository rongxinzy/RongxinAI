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

  $resourcesRoot = $smokeRoot
  $bash = Join-Path $resourcesRoot 'mingit\usr\bin\bash.exe'
  if (-not (Test-Path -LiteralPath $bash)) {
    $bash = Join-Path $resourcesRoot 'mingit\bin\bash.exe'
  }
  $python = Join-Path $resourcesRoot 'python-win\python.exe'
  $skillPython = Join-Path $resourcesRoot 'skill-python\xlsx\Scripts\python.exe'
  $pdfPython = Join-Path $resourcesRoot 'skill-python\pdf\Scripts\python.exe'
  $pandoc = Join-Path $resourcesRoot 'pandoc\pandoc.exe'
  $skillsRoot = Join-Path $resourcesRoot 'SKILLs'

  Assert-Path $bash 'bundled PortableGit Bash'
  Assert-Path $python 'bundled application Python'
  Assert-Path $skillPython 'bundled XLSX Skill Python'
  Assert-Path $pdfPython 'bundled PDF Skill Python'
  Assert-Path (Join-Path $resourcesRoot 'uv-win\uv.exe') 'bundled uv'
  Assert-Path $pandoc 'bundled Pandoc'
  Assert-Path (Join-Path $skillsRoot 'xlsx\scripts\xlsx_reader.py') 'XLSX Skill reader'
  Assert-Path (Join-Path $skillsRoot 'docx\scripts\markdown_to_docx.sh') 'DOCX Markdown converter'

  # Remove Git, Python, Node, and user-installed tool directories from PATH.
  # The smoke test invokes only explicit package paths below.
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $env:UV_OFFLINE = '1'
  foreach ($externalCommand in @('git.exe', 'python.exe', 'python3.exe', 'node.exe')) {
    if (Get-Command $externalCommand -ErrorAction SilentlyContinue) {
      throw "External command unexpectedly remains discoverable on the clean PATH: $externalCommand"
    }
  }

  Invoke-Checked $python @('--version') 'bundled application Python version probe'
  Invoke-Checked $skillPython @('-c', 'import pandas, openpyxl; print("xlsx-dependencies-ok")') 'bundled XLSX dependency probe'
  Invoke-Checked $pdfPython @('-c', 'import reportlab, pypdfium2, PIL; print("pdf-dependencies-ok")') 'bundled PDF dependency probe'
  Invoke-Checked $bash @('-lc', 'printf "portable-git-bash-ok\n"') 'bundled Bash probe'
  Invoke-Checked $pandoc @('--version') 'bundled Pandoc version probe'

  $markdown = Join-Path $smokeRoot 'smoke.md'
  $docx = Join-Path $smokeRoot 'smoke.docx'
  Set-Content -LiteralPath $markdown -Value "# Windows runtime smoke`n`nManaged DOCX conversion works.`n" -Encoding UTF8
  Invoke-Checked $pandoc @('--from', 'markdown', '--to', 'docx', '--output', $docx, $markdown) 'DOCX Markdown conversion'
  Assert-Path $docx 'generated DOCX'

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
