$ErrorActionPreference = 'Stop'

# Windows 发布包构建入口，由 Makefile 的 ci-package-windows 目标调用。
# GitLab 编排逻辑保留在 .gitlab-ci.yml 中，具体构建行为集中在这里。

function Remove-DirectoryIfExists {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (Test-Path $Path) {
    Remove-Item $Path -Recurse -Force
  }
}

function Add-ToPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $env:PATH = "$Path;$env:PATH"
}

if (-not $env:NPM_CONFIG_REGISTRY) {
  $env:NPM_CONFIG_REGISTRY = 'https://registry.npmmirror.com'
}
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}

# 清理上一次构建输出，但保留 node_modules、vendor 运行时等 CI 缓存目录。
Remove-DirectoryIfExists 'dist'
Remove-DirectoryIfExists 'dist-electron'
Remove-DirectoryIfExists 'release'

# 某些自托管 Runner 上，Windows Defender 可能锁定或隔离生成的网关 bundle。
# 添加排除目录需要权限，因此这里是尽力而为，失败不阻断构建。
try {
  Add-MpPreference -ExclusionPath "$env:CI_PROJECT_DIR\vendor\channel-runtime" -ErrorAction Stop
  Add-MpPreference -ExclusionPath "$env:CI_PROJECT_DIR\build-tar" -ErrorAction Stop
  Write-Host 'Defender exclusions added for build directories'
} catch {
  Write-Host "Defender exclusions skipped: $_"
}

$nsisCache = Join-Path $env:TEMP 'electron-builder-cache\nsis'
Remove-DirectoryIfExists $nsisCache

# .exe 安装包依赖 NSIS。若缺少 makensis，electron-builder 可能在后期才失败，
# 因此这里提前检查并给出明确错误。
if (-not (Get-Command makensis -ErrorAction SilentlyContinue)) {
  Write-Error 'NSIS (makensis) was not found in PATH. Install NSIS and add it to PATH.'
  exit 1
}
$nsisVersion = (& makensis -VERSION) -join ' '
Write-Host "makensis $nsisVersion"

# 部分 shell:true 调用的 Node 工具无法稳定处理带空格的安装路径。
# 使用 C:\nodejs junction 可以规避 C:\Program Files\nodejs 的路径问题。
if (-not (Test-Path 'C:\nodejs\node.exe')) {
  New-Item -ItemType Junction -Path 'C:\nodejs' -Target 'C:\Program Files\nodejs' -Force | Out-Null
}
Add-ToPath 'C:\nodejs'
Add-ToPath 'C:\Program Files (x86)\NSIS'

# 优先复用宿主机上已安装的全局工具（bun、pnpm），缺失时才安装。
$globalNpmPrefix = (& npm prefix -g).Trim()
if ($globalNpmPrefix) {
  Add-ToPath $globalNpmPrefix
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host 'bun not found in PATH, installing...'
  npm install -g bun --registry https://registry.npmmirror.com
  # npm -g 安装后重新刷新 PATH，确保刚装的 bun 可被解析。
  $globalNpmPrefix = (& npm prefix -g).Trim()
  if ($globalNpmPrefix) {
    Add-ToPath $globalNpmPrefix
  }
}
bun install
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  npm install -g pnpm --registry https://registry.npmmirror.com
}

# CI 中 Vite 渲染构建需要超过默认 4GB 堆内存；在 npm run 之前设置确保生效。
$env:NODE_OPTIONS = '--max-old-space-size=6144'
Write-Host "NODE_OPTIONS set to $env:NODE_OPTIONS"

pnpm config set registry https://registry.npmmirror.com

# 使用应用内置 uv 管理应用内置 Python 3.14.6；不依赖 Runner 或最终用户的 Python。
$uvArchive = 'C:\ci-cache\uv-x86_64-pc-windows-msvc-0.11.32.zip'
if (Test-Path $uvArchive) {
  $env:ZHIYUAN_PORTABLE_UV_ARCHIVE = $uvArchive
  Write-Host "Using cached uv runtime archive: $uvArchive"
} else {
  Write-Warning "Cached uv archive not found at $uvArchive; setup will download the pinned release"
}

& node scripts/setup-uv-runtime.js --required
if ($LASTEXITCODE -ne 0) { Write-Error 'FATAL: bundled uv setup failed'; exit $LASTEXITCODE }
& node scripts/setup-python-runtime.js --required
if ($LASTEXITCODE -ne 0) { Write-Error 'FATAL: uv-managed Python setup failed'; exit $LASTEXITCODE }
$pythonDir = 'resources\python-win'
& "$pythonDir\python.exe" --version
& "$pythonDir\python.exe" -m pip --version

# CI 中跳过了 Electron postinstall 下载，因此在 electron-builder 运行前
# 需要手动确保 Windows Electron 二进制文件存在。
$electronVersion = $env:ELECTRON_VERSION
if (-not $electronVersion) {
  $electronVersion = '40.2.1'
}
$electronDist = 'node_modules\electron\dist'
if (-not (Test-Path "$electronDist\electron.exe")) {
  Write-Host "Downloading Electron $electronVersion from npmmirror..."
  $electronZip = Join-Path $env:TEMP "electron-v$electronVersion-win32-x64.zip"
  Invoke-WebRequest -Uri "https://npmmirror.com/mirrors/electron/v$electronVersion/electron-v$electronVersion-win32-x64.zip" -OutFile $electronZip
  New-Item -ItemType Directory -Path $electronDist -Force | Out-Null
  Expand-Archive -Path $electronZip -DestinationPath $electronDist -Force
  Remove-Item $electronZip -Force
  Write-Host "Electron extracted to $electronDist"
} else {
  Write-Host "Electron already present at $electronDist"
}
Test-Path "$electronDist\electron.exe" -PathType Leaf

# 正式 release tag 使用 package.json 中的版本号。
# 非 release 构建通过 APP_BUILD_VERSION 追加 commit SHA，供打包前版本处理使用。
$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$packageVersion = $packageJson.version
$isRelease = $env:CI_COMMIT_TAG -match '^v\d+\.\d+\.\d+$'
if (-not $isRelease) {
  $shortSha = if ($env:CI_COMMIT_SHORT_SHA) { $env:CI_COMMIT_SHORT_SHA } else { 'local' }
  $env:APP_BUILD_VERSION = "$packageVersion-$shortSha"
  Write-Host "Dev build: version=$env:APP_BUILD_VERSION"
} else {
  $env:APP_BUILD_VERSION = ''
  Write-Host "Release build: version=$packageVersion"
}

$distWinCommand = 'dist:win:offline'

# 完整 Windows 打包流程由 npm run dist:win:* 编排：
# 应用构建、Channel 运行时、技能构建以及 electron-builder NSIS 输出。
$env:DEBUG = 'electron-builder'
npm run $distWinCommand
$builderExit = $LASTEXITCODE
if ($builderExit -ne 0) {
  Write-Error "electron-builder/npm run $distWinCommand exited with code $builderExit"
}

if ($builderExit -eq 0) {
  Write-Host '=== Verifying bundled runtimes with a clean PATH ==='
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'windows-runtime-smoke.ps1') -ProjectRoot (Get-Location).Path
  $smokeExit = $LASTEXITCODE
  if ($smokeExit -ne 0) {
    Write-Error "Windows runtime smoke gate failed with exit code $smokeExit"
    exit $smokeExit
  }
}

# 无论上传是否成功，都打印 release 目录内容，方便排查 CI 构建问题。
Write-Host '=== Release directory contents ==='
if (Test-Path 'release') {
  Get-ChildItem release -Depth 2 | ForEach-Object { Write-Host ("{0,10} {1}" -f $_.Length, $_.FullName) }
} else {
  Write-Host 'release directory is missing'
}

if ($builderExit -ne 0) {
  exit $builderExit
}

$exe = Get-ChildItem -Path 'release' -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  # 保留 lite 发布通道名称，安装包本身是完整的非 llama.cpp 离线包。
  $bundleSuffix = 'lite'
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($exe.Name)
  $extension = $exe.Extension
  $newName = "$baseName-$bundleSuffix$extension"
  $newPath = Join-Path $exe.DirectoryName $newName
  if ($exe.Name -ne $newName) {
    Move-Item -Path $exe.FullName -Destination $newPath -Force
    $exe = Get-Item $newPath
    Write-Host "Renamed package to $($exe.Name)"
  }

  Write-Host "Package: $($exe.FullName) ($([math]::Round($exe.Length / 1MB, 1)) MB)"
  $encodedName = [uri]::EscapeDataString($exe.Name)
  $uploadUrl = "http://172.18.5.249:8081/artifactory/ZhiYuanAgent/windows/$encodedName"
  Write-Host "Uploading to $uploadUrl ..."

  if ($env:ARTIFACTORY_USER -and $env:ARTIFACTORY_PASSWORD) {
    Write-Host "Auth: user='$env:ARTIFACTORY_USER' password=***"
    # 使用临时 netrc 文件，避免凭据出现在进程命令行中。
    # curl 结束后会立即删除该文件。
    $tmpDir = [System.IO.Path]::GetTempPath()
    $netrc = Join-Path $tmpDir "artifactory-netrc-$PID.txt"
    "machine 172.18.5.249 login $env:ARTIFACTORY_USER password $env:ARTIFACTORY_PASSWORD" | Out-File $netrc -Encoding ASCII
    try {
      $responseFile = Join-Path $tmpDir "artifactory-upload-$PID.json"
      & curl.exe --silent --show-error --fail --connect-timeout 10 --max-time 900 --netrc-file "$netrc" -T "$($exe.FullName)" -o "$responseFile" "$uploadUrl" 2>&1
      $curlExit = $LASTEXITCODE
      if ($curlExit -eq 0) {
        $response = Get-Content $responseFile -Raw -ErrorAction SilentlyContinue
        Write-Host 'Uploaded to Artifactory'
        if ($response) {
          Write-Host "Response: $response"
        }
      } else {
        Write-Host "Artifactory upload exit=$curlExit (non-fatal)"
      }
      Remove-Item $responseFile -Force -ErrorAction SilentlyContinue
    } finally {
      Remove-Item $netrc -Force -ErrorAction SilentlyContinue
    }
  } else {
    Write-Host 'Skipping upload: ARTIFACTORY_USER or ARTIFACTORY_PASSWORD not set'
  }
} else {
  Write-Error 'FATAL: electron-builder finished but no .exe found in release/'
  # 区分 NSIS 安装包生成失败与更早阶段的 ASAR 或应用打包失败。
  if (Test-Path 'release\win-unpacked') {
    Write-Error '  -> win-unpacked/ directory EXISTS: ASAR packaging succeeded, NSIS installer creation failed'
    Write-Host 'win-unpacked contents:'
    Get-ChildItem 'release\win-unpacked' -Recurse -Depth 2 | ForEach-Object { Write-Host "  $($_.FullName)" }
  } else {
    Write-Error '  -> win-unpacked/ directory MISSING: even ASAR packaging did not complete'
  }
  exit 1
}
