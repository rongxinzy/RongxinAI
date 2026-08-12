@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
:: 知远智能体 Windows 编译与打包环境一键安装脚本
:: ============================================================
:: 使用方式：以管理员身份运行此脚本
:: 功能：自动安装所有编译和打包所需的环境依赖
:: ============================================================

title 知远智能体 环境安装程序

echo.
echo ============================================================
echo   知远智能体 Windows 编译与打包环境一键安装
echo ============================================================
echo.

:: -----------------------------------------------------------
:: 步骤 0: 检查管理员权限
:: -----------------------------------------------------------
echo [0/8] 检查管理员权限...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [错误] 此脚本需要管理员权限运行！
    echo        请右键此文件，选择"以管理员身份运行"。
    echo.
    pause
    exit /b 1
)
echo       √ 已获取管理员权限
echo.

:: -----------------------------------------------------------
:: 步骤 1: 检查并安装 Node.js 24.x
:: -----------------------------------------------------------
echo [1/8] 检查 Node.js...

:: 先刷新 PATH 以便检测已安装但未在当前 session 中的程序
set "PATH=C:\Program Files\nodejs;%PATH%"

where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
    echo !NODE_VER! | findstr /r "^v24\." >nul 2>&1
    if !errorlevel! equ 0 (
        echo       √ Node.js 已安装: !NODE_VER!
    ) else (
        echo       ! Node.js 已安装但版本不对: !NODE_VER!
        echo         需要 24.x 版本，正在安装...
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if !errorlevel! neq 0 (
            echo       [警告] winget 安装失败，请手动从 https://nodejs.org/ 下载 Node.js 24.x
        )
    )
) else (
    echo       Node.js 未安装，正在通过 winget 安装...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if !errorlevel! neq 0 (
        echo       [警告] winget 安装失败，请手动从 https://nodejs.org/ 下载 Node.js 24.x
    )
)

:: 刷新 PATH
set "PATH=C:\Program Files\nodejs;%PATH%"
echo.

:: -----------------------------------------------------------
:: 步骤 2: 检查并安装 Git
:: -----------------------------------------------------------
echo [2/8] 检查 Git...

set "PATH=C:\Program Files\Git\cmd;%PATH%"

where git >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('git --version 2^>nul') do set GIT_VER=%%v
    echo       √ Git 已安装: !GIT_VER!
) else (
    echo       Git 未安装，正在通过 winget 安装...
    winget install Git.Git --accept-source-agreements --accept-package-agreements
    if !errorlevel! neq 0 (
        echo       [警告] winget 安装失败，请手动从 https://git-scm.com/ 下载 Git
    )
    set "PATH=C:\Program Files\Git\cmd;%PATH%"
)
echo.

:: -----------------------------------------------------------
:: 步骤 3: 检查并安装 7-Zip
:: -----------------------------------------------------------
echo [3/8] 检查 7-Zip...

if exist "C:\Program Files\7-Zip\7z.exe" (
    echo       √ 7-Zip 已安装
) else (
    echo       7-Zip 未安装，正在通过 winget 安装...
    winget install 7zip.7zip --accept-source-agreements --accept-package-agreements
    if !errorlevel! neq 0 (
        echo       [警告] winget 安装失败，请手动从 https://www.7-zip.org/ 下载 7-Zip
    )
)
echo.

:: -----------------------------------------------------------
:: 步骤 4: 启用 Windows 开发者模式
:: -----------------------------------------------------------
echo [4/8] 启用 Windows 开发者模式（符号链接权限）...

reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2>nul | findstr "0x1" >nul 2>&1
if %errorlevel% equ 0 (
    echo       √ Windows 开发者模式已启用
) else (
    reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense /t REG_DWORD /d 1 /f >nul 2>&1
    reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowAllTrustedApps /t REG_DWORD /d 1 /f >nul 2>&1
    if !errorlevel! equ 0 (
        echo       √ Windows 开发者模式已成功启用
    ) else (
        echo       [警告] 启用失败，请手动在 设置 -^> 更新和安全 -^> 开发者选项 中启用
    )
)
echo.

:: -----------------------------------------------------------
:: 步骤 5: 配置 PATH 环境变量
:: -----------------------------------------------------------
echo [5/8] 配置 PATH 环境变量...

:: 读取当前用户 PATH
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr Path') do set "CURRENT_USER_PATH=%%b"

set "NEED_UPDATE=0"
set "NEW_PATH=!CURRENT_USER_PATH!"

:: 检查 Node.js 路径
echo !CURRENT_USER_PATH! | findstr /i "nodejs" >nul 2>&1
if !errorlevel! neq 0 (
    set "NEW_PATH=C:\Program Files\nodejs;!NEW_PATH!"
    set "NEED_UPDATE=1"
    echo       + 添加 Node.js 到 PATH
)

:: 检查 Git 路径
echo !CURRENT_USER_PATH! | findstr /i "Git\\cmd" >nul 2>&1
if !errorlevel! neq 0 (
    set "NEW_PATH=C:\Program Files\Git\cmd;!NEW_PATH!"
    set "NEED_UPDATE=1"
    echo       + 添加 Git 到 PATH
)

:: 检查 npm 全局路径
echo !CURRENT_USER_PATH! | findstr /i "Roaming\\npm" >nul 2>&1
if !errorlevel! neq 0 (
    set "NEW_PATH=%APPDATA%\npm;!NEW_PATH!"
    set "NEED_UPDATE=1"
    echo       + 添加 npm 全局路径到 PATH
)

if "!NEED_UPDATE!"=="1" (
    setx PATH "!NEW_PATH!" >nul 2>&1
    echo       √ PATH 已更新（新 cmd 窗口生效）
) else (
    echo       √ PATH 配置已完整，无需修改
)

:: 更新当前 session 的 PATH
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\cmd;%APPDATA%\npm;%PATH%"
echo.

:: -----------------------------------------------------------
:: 步骤 6: 清理干扰环境变量
:: -----------------------------------------------------------
echo [6/8] 清理干扰环境变量...

:: 检查并清理 ELECTRON_RUN_AS_NODE
reg query "HKCU\Environment" /v ELECTRON_RUN_AS_NODE >nul 2>&1
if %errorlevel% equ 0 (
    reg delete "HKCU\Environment" /v ELECTRON_RUN_AS_NODE /f >nul 2>&1
    echo       √ 已删除用户级 ELECTRON_RUN_AS_NODE
) else (
    echo       √ ELECTRON_RUN_AS_NODE 不存在（正常）
)

reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v ELECTRON_RUN_AS_NODE >nul 2>&1
if %errorlevel% equ 0 (
    reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v ELECTRON_RUN_AS_NODE /f >nul 2>&1
    echo       √ 已删除系统级 ELECTRON_RUN_AS_NODE
)

:: 同时清除当前 session
set "ELECTRON_RUN_AS_NODE="
echo.

:: -----------------------------------------------------------
:: 步骤 7: 安装项目依赖
:: -----------------------------------------------------------
echo [7/8] 安装项目依赖 (npm install)...

:: 确定项目目录（脚本所在目录的上一级）
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."

:: 检查 package.json 是否存在
if not exist "%PROJECT_DIR%\package.json" (
    echo       [错误] 未找到 package.json！
    echo       请确保此脚本位于项目的 scripts/ 目录下。
    echo       当前检查路径: %PROJECT_DIR%
    echo.
    goto :verify
)

cd /d "%PROJECT_DIR%"
echo       项目目录: %CD%

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo       [错误] npm 命令不可用！
    echo       请先关闭此窗口，重新打开管理员 cmd，然后再次运行此脚本。
    echo       （Node.js 刚刚安装，需要新窗口才能生效）
    echo.
    goto :verify
)

:: 检查 node_modules 是否已存在
if exist "node_modules\.bin\electron-builder.cmd" (
    echo       √ node_modules 已存在，跳过安装
    echo       （如需重新安装，请先删除 node_modules 目录后重新运行脚本）
) else (
    echo       正在执行 npm install ...
    echo       （首次安装可能需要几分钟，请耐心等待）
    echo.
    call npm install
    if !errorlevel! neq 0 (
        echo.
        echo       [警告] npm install 执行出错，请检查网络连接后重试
        echo       也可以尝试设置镜像源后重试：
        echo         npm config set registry https://registry.npmmirror.com
        echo         npm install
    ) else (
        echo.
        echo       √ npm install 完成
    )
)
echo.

:: -----------------------------------------------------------
:: 步骤 8: 环境验证
:: -----------------------------------------------------------
:verify
echo [8/8] 验证环境...
echo.

set "PASS_COUNT=0"
set "FAIL_COUNT=0"

:: 验证 Node.js
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do (
        echo       [√] Node.js %%v
        set /a PASS_COUNT+=1
    )
) else (
    echo       [×] Node.js 未找到
    set /a FAIL_COUNT+=1
)

:: 验证 npm
where npm >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('npm --version 2^>nul') do (
        echo       [√] npm %%v
        set /a PASS_COUNT+=1
    )
) else (
    echo       [×] npm 未找到
    set /a FAIL_COUNT+=1
)

:: 验证 Git
where git >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('git --version 2^>nul') do (
        echo       [√] %%v
        set /a PASS_COUNT+=1
    )
) else (
    echo       [×] Git 未找到
    set /a FAIL_COUNT+=1
)

:: 验证 7-Zip
if exist "C:\Program Files\7-Zip\7z.exe" (
    echo       [√] 7-Zip 已安装
    set /a PASS_COUNT+=1
) else (
    echo       [×] 7-Zip 未找到
    set /a FAIL_COUNT+=1
)

:: 验证 Windows 开发者模式
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2>nul | findstr "0x1" >nul 2>&1
if %errorlevel% equ 0 (
    echo       [√] Windows 开发者模式已启用
    set /a PASS_COUNT+=1
) else (
    echo       [×] Windows 开发者模式未启用
    set /a FAIL_COUNT+=1
)

:: 验证 ELECTRON_RUN_AS_NODE 不存在
reg query "HKCU\Environment" /v ELECTRON_RUN_AS_NODE >nul 2>&1
if %errorlevel% neq 0 (
    echo       [√] ELECTRON_RUN_AS_NODE 不存在（正常）
    set /a PASS_COUNT+=1
) else (
    echo       [×] ELECTRON_RUN_AS_NODE 仍然存在（需要清理）
    set /a FAIL_COUNT+=1
)

:: 验证 node_modules
if exist "%PROJECT_DIR%\node_modules\.bin\electron-builder.cmd" (
    echo       [√] 项目依赖已安装
    set /a PASS_COUNT+=1
) else (
    echo       [×] 项目依赖未安装（需执行 npm install）
    set /a FAIL_COUNT+=1
)

:: 验证 Electron 二进制
if exist "%PROJECT_DIR%\node_modules\electron\dist\electron.exe" (
    echo       [√] Electron 二进制已下载
    set /a PASS_COUNT+=1
) else (
    echo       [×] Electron 二进制缺失
    set /a FAIL_COUNT+=1
)

echo.
echo ============================================================

if !FAIL_COUNT! equ 0 (
    echo   ✅ 所有检查通过！（!PASS_COUNT!/!PASS_COUNT!）
    echo.
    echo   环境已就绪，可以在新的 cmd 窗口中执行以下命令：
    echo.
    echo     cd %PROJECT_DIR%
    echo     npm run electron:dev          ^(开发模式^)
    echo     npm run dist:win              ^(打包 Windows 安装包^)
    echo.
    echo   注意：如果本次新安装了 Node.js 或 Git，
    echo   请关闭当前窗口，打开新的 cmd 窗口再执行以上命令。
) else (
    echo   ⚠ 有 !FAIL_COUNT! 项检查未通过，请根据上方提示处理。
    echo.
    echo   如果是首次安装了 Node.js / Git，请：
    echo     1. 关闭当前窗口
    echo     2. 打开新的管理员 cmd 窗口
    echo     3. 重新运行此脚本
)

echo ============================================================
echo.
pause
endlocal
