!include "FileFunc.nsh"

!macro customHeader
  ManifestDPIAware true
  RequestExecutionLevel admin
  ShowInstDetails nevershow
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用知远智能体"
  !define MUI_WELCOMEPAGE_TEXT "知远智能体是面向真实工作的 AI 工作台。安装程序将为你准备完整的离线运行环境；本地推理组件可在应用启动后按需下载。$\r$\n$\r$\n点击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  SetDetailsPrint textonly
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  System::Call 'kernel32::GetTickCount()i .r9'
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" w
  FileWrite $8 "$9"
  FileClose $8
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-timing.log" w
  FileWrite $8 "phase=custom-init-start tick_ms=$9 instdir=$INSTDIR$\r$\n"
  FileClose $8

  DetailPrint "[Installer] Stopping running 知远 processes"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name 知远 -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*ZhiYuanAgent*\" -or $$_.Path -like \"*知远*\" } | Stop-Process -Force -ErrorAction SilentlyContinue;\
    for ($$i = 0; $$i -lt 15; $$i++) {\
      $$appProcesses = @(Get-Process -Name 知远 -ErrorAction SilentlyContinue);\
      $$nodeProcesses = @(Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*ZhiYuanAgent*\" -or $$_.Path -like \"*知远*\" });\
      if (($$appProcesses.Count + $$nodeProcesses.Count) -eq 0) { break };\
      Start-Sleep -Milliseconds 500;\
    }"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $8 "phase=process-stop-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $8

  DetailPrint "[Installer] Migrating user-created Skills"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$source = \"$INSTDIR\resources\SKILLs\";\
    $$destination = \"$APPDATA\ZhiYuanAgent\SKILLs\";\
    $$config = Join-Path $$source \"skills.config.json\";\
    $$weixinAccounts = @(\
      (Join-Path $$env:USERPROFILE \".openclaw\openclaw-weixin\accounts\"),\
      (Join-Path $$env:APPDATA \"ZhiYuanAgent\openclaw\state\openclaw-weixin\accounts\")\
    );\
    foreach ($$directory in $$weixinAccounts) {\
      if (Test-Path $$directory) { Remove-Item -Path $$directory -Recurse -Force -ErrorAction SilentlyContinue }\
    };\
    if (Test-Path $$source) {\
      New-Item -ItemType Directory -Path $$destination -Force | Out-Null;\
      $$bundled = @(try {\
        if (Test-Path $$config) {\
          (Get-Content $$config -Raw | ConvertFrom-Json).defaults.PSObject.Properties.Name\
        }\
      } catch { });\
      Get-ChildItem -Path $$source -Directory | Where-Object { $$bundled -notcontains $$_.Name } | ForEach-Object {\
        $$target = Join-Path $$destination $$_.Name;\
        if (-not (Test-Path $$target)) { Copy-Item -Path $$_.FullName -Destination $$target -Recurse -Force }\
      };\
    }"'
  Pop $0
  Pop $1
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $8 "phase=skill-migration-complete elapsed_ms=$5 exit=$0 output=$1$\r$\n"
  FileClose $8

  ; Rename the old application quickly. Its directory junctions do not copy the
  ; shared resource pack, and physical cleanup is delayed until installation ends.
  DetailPrint "[Installer] Detaching previous application version"
  System::Call 'kernel32::GetTickCount()i .r7'
  IfFileExists "$INSTDIR\*.*" 0 OldInstallDetachDone
    System::Call 'kernel32::GetTickCount()i .r4'
    StrCpy $3 "$INSTDIR.old.$4"
    Rename "$INSTDIR" "$3"
    IfErrors OldInstallDetachDone
    FileOpen $8 "$APPDATA\ZhiYuanAgent\old-install-path.txt" w
    FileWrite $8 "$3"
    FileClose $8
  OldInstallDetachDone:
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $8 "phase=old-install-detached elapsed_ms=$5 path=$3$\r$\n"
  FileClose $8
!macroend

!macro customInstall
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  CreateDirectory "$LOCALAPPDATA\ZhiYuanAgent\runtime-packs"
  DetailPrint "[Installer] Checking bundled offline resources"
  System::Call 'kernel32::GetTickCount()i .r7'

  SetOutPath "$PLUGINSDIR"
  File /oname=win-resources.version "${PROJECT_DIR}\build-tar\win-resources.version"
  FileOpen $2 "$PLUGINSDIR\win-resources.version" r
  IfErrors ResourcePackVersionInvalid
  FileRead $2 $R1
  FileClose $2
  StrCpy $R1 $R1 64
  StrLen $R4 $R1
  IntCmp $R4 64 0 ResourcePackVersionInvalid ResourcePackVersionInvalid

  StrCpy $R2 "$LOCALAPPDATA\ZhiYuanAgent\runtime-packs\$R1"
  IfFileExists "$R2\.complete" 0 ResourcePackCacheMiss
  FileOpen $2 "$R2\.complete" r
  IfErrors ResourcePackCacheMiss
  FileRead $2 $R4
  FileClose $2
  StrCpy $R4 $R4 64
  StrCmp $R4 $R1 0 ResourcePackCacheMiss
  IfFileExists "$R2\cfmind\package.json" 0 ResourcePackCacheMiss
  IfFileExists "$R2\SKILLs\skills.config.json" 0 ResourcePackCacheMiss
  IfFileExists "$R2\MCPs\compatibility-review.md" 0 ResourcePackCacheMiss
  IfFileExists "$R2\python-win\python.exe" 0 ResourcePackCacheMiss
  IfFileExists "$R2\uv-win\uv.exe" 0 ResourcePackCacheMiss
  IfFileExists "$R2\uv-win\uvx.exe" 0 ResourcePackCacheMiss
  IfFileExists "$R2\mingit\usr\bin\bash.exe" ResourcePackCachePortableGitReady 0
  IfFileExists "$R2\mingit\bin\bash.exe" ResourcePackCachePortableGitReady ResourcePackCacheMiss
  ResourcePackCachePortableGitReady:
  DetailPrint "[Installer] Reusing unchanged offline resources"
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $2 "phase=resource-pack-cache-hit pack_id=$R1$\r$\n"
  FileClose $2
  Goto ResourcePackReady

  ResourcePackCacheMiss:
    DetailPrint "[Installer] Expanding bundled offline resources (first use of this version)"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=resource-pack-cache-miss pack_id=$R1$\r$\n"
    FileClose $2
    StrCpy $R3 "$LOCALAPPDATA\ZhiYuanAgent\runtime-packs\$R1.installing"
    RMDir /r "$R3"
    CreateDirectory "$R3"

    ; This payload is always embedded in the installer, so cold installation is
    ; fully offline. NSIS only expands it when the versioned cache is absent.
    SetOutPath "$PLUGINSDIR"
    File /oname=win-resources.tar "${PROJECT_DIR}\build-tar\win-resources.tar"
    nsExec::ExecToStack '"$SYSDIR\tar.exe" -xf "$PLUGINSDIR\win-resources.tar" -C "$R3"'
    Pop $0
    Pop $1
    StrCmp $0 "error" ResourcePackExtractFailed
    IntCmp $0 0 ResourcePackExtracted ResourcePackExtractFailed ResourcePackExtractFailed

  ResourcePackExtractFailed:
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=resource-pack-extract-failed pack_id=$R1 exit=$0 output=$1$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONSTOP "离线运行环境展开失败（代码 $0）。请检查磁盘空间或安全软件后重试。详细信息位于 %APPDATA%\ZhiYuanAgent\install-timing.log。"
    Abort

  ResourcePackExtracted:
    IfFileExists "$R3\cfmind\package.json" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\SKILLs\skills.config.json" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\MCPs\compatibility-review.md" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\python-win\python.exe" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\uv-win\uv.exe" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\uv-win\uvx.exe" 0 ResourcePackVerificationFailed
    IfFileExists "$R3\mingit\usr\bin\bash.exe" ResourcePackExtractedPortableGitReady 0
    IfFileExists "$R3\mingit\bin\bash.exe" ResourcePackExtractedPortableGitReady ResourcePackVerificationFailed
  ResourcePackExtractedPortableGitReady:
    FileOpen $2 "$R3\.complete" w
    FileWrite $2 "$R1"
    FileClose $2
    RMDir /r "$R2"
    Rename "$R3" "$R2"
    IfErrors ResourcePackCommitFailed
    Delete "$PLUGINSDIR\win-resources.tar"
    Goto ResourcePackReady

  ResourcePackVerificationFailed:
    MessageBox MB_OK|MB_ICONSTOP "离线运行环境校验失败，安装包可能不完整。请重新下载安装包后重试。"
    Abort

  ResourcePackCommitFailed:
    MessageBox MB_OK|MB_ICONSTOP "无法启用离线运行环境。请确认当前用户对 %LOCALAPPDATA%\ZhiYuanAgent 有写入权限。"
    Abort

  ResourcePackVersionInvalid:
    MessageBox MB_OK|MB_ICONSTOP "安装包缺少有效的离线资源版本信息。请重新下载安装包。"
    Abort

  ResourcePackReady:
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=resource-pack-ready pack_id=$R1 elapsed_ms=$5$\r$\n"
    FileClose $2

  ; Keep application paths stable while the immutable pack remains outside the
  ; versioned installation directory and can be reused by later upgrades.
  DetailPrint "[Installer] Connecting bundled runtimes"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$resourceRoot = \"$INSTDIR\resources\";\
    $$packRoot = \"$R2\";\
    $$names = @(\"cfmind\", \"SKILLs\", \"MCPs\", \"mingit\", \"python-win\", \"skill-python\", \"uv-win\");\
    foreach ($$name in $$names) {\
      $$link = Join-Path $$resourceRoot $$name;\
      $$target = Join-Path $$packRoot $$name;\
      if (-not (Test-Path $$target)) { throw \"Missing resource pack directory: $$target\" };\
      if (Test-Path $$link) {\
        $$existing = Get-Item -LiteralPath $$link -Force;\
        if (($$existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {\
          [IO.Directory]::Delete($$link);\
        } else {\
          Remove-Item -LiteralPath $$link -Recurse -Force;\
        }\
      };\
      New-Item -ItemType Junction -Path $$link -Target $$target -Force | Out-Null;\
    }"'
  Pop $0
  Pop $1
  StrCmp $0 "0" RuntimeLinksReady
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=runtime-link-failed exit=$0 output=$1$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONSTOP "离线运行环境连接失败：$1"
    Abort
  RuntimeLinksReady:

  DetailPrint "[Installer] Verifying bundled runtimes"
  IfFileExists "$INSTDIR\resources\python-win\python.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\uv-win\uv.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\cfmind\package.json" 0 InstalledRuntimeVerificationFailed
  Goto InstalledRuntimeVerificationDone
  InstalledRuntimeVerificationFailed:
    MessageBox MB_OK|MB_ICONSTOP "离线运行环境连接校验失败。请重新运行安装器。"
    Abort
  InstalledRuntimeVerificationDone:

  ; The VC runtime is bundled for offline installation, but upgrades skip it
  ; when the supported x64 redistributable is already registered.
  DetailPrint "[Installer] Checking Microsoft Visual C++ Runtime"
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  IfErrors InstallVcRuntime
  IntCmp $0 1 VcRuntimeReady InstallVcRuntime InstallVcRuntime
  InstallVcRuntime:
    IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 VcRuntimeReady
    DetailPrint "[Installer] Installing Microsoft Visual C++ Runtime"
    nsExec::ExecToStack '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart'
    Pop $0
    Pop $1
    StrCmp $0 "0" VcRuntimeReady
    StrCmp $0 "1638" VcRuntimeReady
    StrCmp $0 "3010" VcRuntimeReady
      MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Visual C++ Runtime 未能自动安装。知远仍会完成安装，但部分本地组件可能暂时不可用。"
  VcRuntimeReady:

  ; Local inference remains optional. The installer records only an intent;
  ; download, verification, extraction, cancellation and retry happen in-app.
  IfSilent LocalInferencePromptDone 0
  Delete "$APPDATA\ZhiYuanAgent\pending-local-inference-install"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否在启动知远后安装本地推理组件？$\r$\n$\r$\n知远会根据硬件推荐 CPU 或 NVIDIA CUDA 后端，需额外下载约 16 MB–621 MB。下载将在应用内显示进度并可取消；选择“否”不影响其他功能。" IDYES RecordLocalInferenceIntent IDNO LocalInferencePromptDone
  RecordLocalInferenceIntent:
    FileOpen $2 "$APPDATA\ZhiYuanAgent\pending-local-inference-install" w
    FileWrite $2 "$R1"
    FileClose $2
  LocalInferencePromptDone:

  ; Cleanup begins only after core application and runtime links are ready, so
  ; it no longer competes with resource expansion on slow disks.
  DetailPrint "[Installer] Scheduling previous version cleanup"
  ; Remove known junctions explicitly before recursive deletion. This prevents
  ; an old installation cleanup from ever walking into an immutable shared pack.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    $$names = @("cfmind", "SKILLs", "MCPs", "mingit", "python-win", "skill-python", "uv-win");\
    Get-ChildItem -Path "$INSTDIR.old*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {\
      $$oldResources = Join-Path $$_.FullName "resources";\
      foreach ($$name in $$names) {\
        $$link = Join-Path $$oldResources $$name;\
        if (Test-Path -LiteralPath $$link) {\
          $$item = Get-Item -LiteralPath $$link -Force;\
          if (($$item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {\
            [IO.Directory]::Delete($$link)\
          }\
        }\
      }\
    }"'
  Pop $0
  nsExec::ExecToLog 'cmd /c for /d %D in ("$INSTDIR.old*") do @start "" /b cmd /c rd /s /q "%~fD"'
  Pop $0
  Delete "$APPDATA\ZhiYuanAgent\old-install-path.txt"

  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors InstallTimingDone
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $2 "phase=install-complete total_ms=$R6 pack_id=$R1$\r$\n"
  FileClose $2
  Delete "$APPDATA\ZhiYuanAgent\install-start-tick.txt"
  InstallTimingDone:
  DetailPrint "Installation complete"
!macroend

!macro customUnInit
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name 知远 -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*ZhiYuanAgent*\" -or $$_.Path -like \"*知远*\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
!macroend

!macro customUnInstall
  ; Runtime packs are application-owned immutable data. User-created Skills and
  ; models remain under userData and follow electron-builder's uninstall choice.
  RMDir /r "$LOCALAPPDATA\ZhiYuanAgent\runtime-packs"
!macroend
