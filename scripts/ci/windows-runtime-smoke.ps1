param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$ComponentsDir = '',
  # lite must ship exactly the fixed component set (scripts/nsis-offline-components.json).
  # cpu/cuda are new editions: the fixed set must be present, and anything
  # added (llamacpp-bundled) is integrity-checked and reported, never counted.
  [string]$InferenceEdition = $(if ($env:ZHIYUAN_UPDATE_VARIANT) { $env:ZHIYUAN_UPDATE_VARIANT } else { 'lite' })
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

if (-not $ComponentsDir) {
  $ComponentsDir = Join-Path $ProjectRoot 'build-tar\windows-components'
}
$componentManifestPath = Join-Path $ComponentsDir 'manifest.json'
Assert-Path $componentManifestPath 'Windows component manifest'
$componentManifest = Get-Content -LiteralPath $componentManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($componentManifest.offline -ne $true) {
  throw 'Windows component manifest must declare offline=true'
}
$InferenceEdition = $InferenceEdition.Trim().ToLowerInvariant()
$bundlesLlamaCpp = $InferenceEdition -eq 'cpu' -or $InferenceEdition -eq 'cuda'
# The fixed (lite) component keys come from the same file the NSIS installer
# embeds as component-targets.json; never hard-code a count here.
$baseTargetsPath = Join-Path $ProjectRoot 'scripts\nsis-offline-components.json'
Assert-Path $baseTargetsPath 'fixed offline component targets'
$baseKeys = @((Get-Content -LiteralPath $baseTargetsPath -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_.key })
$manifestKeys = @($componentManifest.components | ForEach-Object { $_.key })
foreach ($key in $baseKeys) {
  if (@($manifestKeys | Where-Object { $_ -eq $key }).Count -ne 1) {
    throw "Windows component manifest must contain fixed component $key exactly once"
  }
}
$extraKeys = @($manifestKeys | Where-Object { $baseKeys -notcontains $_ })
if (-not $bundlesLlamaCpp -and $extraKeys.Count -gt 0) {
  # lite: original exact-set gate stays enforced.
  throw "Windows component manifest for edition ${InferenceEdition} has unexpected components: $($extraKeys -join ', ')"
}
Write-Host ("[measure] windows-component-set edition={0} count={1} keys={2}" -f $InferenceEdition, $manifestKeys.Count, ($manifestKeys -join ','))

# Extract with the same pinned 7za.exe the NSIS and WebView2 installers embed
# (node_modules/7zip-bin, hash recorded in windows-components/7za.sha256).
# System32 tar.exe is not used: its LZMA support differs per Windows image
# (windows-2022 lacks it), and end users never extract components with it.
$sevenZip = Join-Path $ProjectRoot 'node_modules\7zip-bin\win\x64\7za.exe'
Assert-Path $sevenZip 'pinned 7za.exe'
$sevenZipHashPath = Join-Path $ComponentsDir '7za.sha256'
Assert-Path $sevenZipHashPath 'pinned 7za.exe SHA-256'
$expectedSevenZipHash = (Get-Content -LiteralPath $sevenZipHashPath -Raw).Trim().ToLowerInvariant()
$actualSevenZipHash = (Get-FileHash -LiteralPath $sevenZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSevenZipHash -ne $expectedSevenZipHash) {
  throw "SHA-256 mismatch for pinned 7za.exe"
}

$smokeRoot = Join-Path $env:TEMP ("zhiyuan-runtime-smoke-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
$oldPath = $env:PATH
try {
  New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
  foreach ($component in @($componentManifest.components)) {
    $isLlamaComponent = $component.key -match 'llama' -or $component.prefix -match 'llama'
    if ($isLlamaComponent -and -not ($bundlesLlamaCpp -and $component.key -eq 'llamacpp-bundled' -and $component.prefix -eq 'llamacpp-bundled')) {
      throw "The offline component manifest must not include llama.cpp for edition ${InferenceEdition}: $($component.key)"
    }
    $archivePath = Join-Path $ComponentsDir $component.archive
    Assert-Path $archivePath "Windows component archive $($component.key)"
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $component.archiveSha256) {
      throw "SHA-256 mismatch for Windows component $($component.key)"
    }
    if ((Get-Item -LiteralPath $archivePath).Length -ne $component.archiveSizeBytes) {
      throw "Size mismatch for Windows component $($component.key)"
    }
    Invoke-Checked $sevenZip @('x', '-y', "-o$smokeRoot", $archivePath) "Windows component extraction: $($component.key)"
    $sentinelPath = Join-Path $smokeRoot $component.sentinel
    Assert-Path $sentinelPath "Windows component sentinel $($component.key)"
    if ($component.sentinelSha256 -notmatch '^[0-9a-f]{64}$') {
      throw "Missing sentinel SHA-256 for Windows component $($component.key)"
    }
    $sentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sentinelHash -ne $component.sentinelSha256) {
      throw "Sentinel SHA-256 mismatch for Windows component $($component.key)"
    }
  }

  $resourcesRoot = $smokeRoot
  Assert-Path (Join-Path $resourcesRoot 'channel-runtime\cc-connect-sidecar.exe') 'bundled channel runtime'
  Assert-Path (Join-Path $ProjectRoot 'release\win-unpacked\resources\memory\engram.exe') 'bundled memory runtime'
  $bash = Join-Path $resourcesRoot 'mingit\usr\bin\bash.exe'
  if (-not (Test-Path -LiteralPath $bash)) {
    $bash = Join-Path $resourcesRoot 'mingit\bin\bash.exe'
  }
  $python = Join-Path $resourcesRoot 'python-win\python.exe'
  $skillPython = Join-Path $resourcesRoot 'skill-python\layers\shared\Scripts\python.exe'
  $appExecutableName = $env:ZHIYUAN_ELECTRON_EXECUTABLE_NAME
  if (-not $appExecutableName) {
    $builderConfigPath = Join-Path $ProjectRoot 'electron-builder.json'
    Assert-Path $builderConfigPath 'electron-builder configuration'
    $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $appExecutableName = $builderConfig.executableName
    if (-not $appExecutableName) {
      $appExecutableName = $builderConfig.productName
    }
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
  Assert-Path $skillPython 'bundled shared Skill Python'
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
  if ($bundlesLlamaCpp) {
    # Correctness (always enforced): the llama.cpp runtime extracted from the
    # offline component must start from a clean PATH. The accelerated servers
    # need hardware the hosted runner lacks (the CUDA server imports nvcuda.dll
    # from the NVIDIA driver; the Vulkan server needs a Vulkan ICD), so the
    # portable CPU fallback is what must launch everywhere. The CUDA server's
    # DLL import closure is verified at build time by
    # finalize-llamacpp-cuda-edition.cjs (scripts/windows-pe-imports.cjs), and
    # it is launched here too when the host does have the NVIDIA driver.
    $llamaRoot = Join-Path $resourcesRoot 'llamacpp-bundled'
    $llamaManifest = Get-Content -LiteralPath (Join-Path $llamaRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $llamaLaunch = @()
    if ($llamaManifest.cpuFallbackExecutable) { $llamaLaunch += $llamaManifest.cpuFallbackExecutable }
    else { $llamaLaunch += $llamaManifest.executable }
    $hasNvidiaDriver = Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\nvcuda.dll')
    if ($InferenceEdition -eq 'cuda' -and $hasNvidiaDriver) { $llamaLaunch += $llamaManifest.executable }
    foreach ($llamaExecutable in $llamaLaunch) {
      $llamaServer = Join-Path $llamaRoot ($llamaExecutable -replace '/', '\')
      Assert-Path $llamaServer "bundled llama-server ($llamaExecutable)"
      Invoke-Checked $llamaServer @('--version') "bundled llama-server launch ($llamaExecutable)"
    }
    Assert-Path (Join-Path $llamaRoot ($llamaManifest.executable -replace '/', '\')) "bundled primary llama-server ($($llamaManifest.executable))"
    $llamaFiles = @(Get-ChildItem -LiteralPath $llamaRoot -Recurse -File)
    $llamaBytes = ($llamaFiles | Measure-Object -Property Length -Sum).Sum
    Write-Host ("[measure] windows-llamacpp-bundled edition={0} files={1} bytes={2} launched={3}" -f $InferenceEdition, $llamaFiles.Count, $llamaBytes, ($llamaLaunch -join ','))
  }
  # Windows PowerShell 5.1 strips nested quotes from native process arguments.
  # Keep these probes quote-free so the Python code is identical on clean CI hosts.
  Invoke-Checked $skillPython @('-c', 'import pandas, openpyxl; print(1)') 'bundled XLSX dependency probe'
  Invoke-Checked $skillPython @('-c', 'import reportlab, pypdfium2, PIL; print(1)') 'bundled PDF dependency probe'
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
