!include "FileFunc.nsh"

!define ELEVATED_ACTION_SCRIPT "nsis-elevated-actions.ps1"
!define ELEVATED_ACTION_RESULT "elevated-action-result.txt"

!macro ExtractElevatedActionScript
  SetOutPath "$PLUGINSDIR"
  File /oname=${ELEVATED_ACTION_SCRIPT} "${PROJECT_DIR}\scripts\nsis-elevated-actions.ps1"
!macroend

!macro RunElevatedAction TOKEN ACTION TARGET
  Delete "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}"
  StrCpy $0 "error"
  StrCpy $1 ""
  ClearErrors
  ExecShellWait "runas" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$PLUGINSDIR\${ELEVATED_ACTION_SCRIPT}$\" -Action ${ACTION} -Target $\"${TARGET}$\" -ResultPath $\"$PLUGINSDIR\${ELEVATED_ACTION_RESULT}$\"' SW_HIDE $0
  IfErrors ElevatedActionResult_${TOKEN}
  IfFileExists "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}" 0 ElevatedActionResult_${TOKEN}
    FileOpen $2 "$PLUGINSDIR\${ELEVATED_ACTION_RESULT}" r
    FileRead $2 $1
    FileClose $2
  ElevatedActionResult_${TOKEN}:
!macroend

!macro customHeader
  ManifestDPIAware true
  ; The application and immutable runtime cache are per-user. Elevated helper
  ; processes are used only for optional Windows-wide settings below.
  RequestExecutionLevel user
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

!macro EnsureOfflineComponent TOKEN KEY PREFIX SENTINEL LABEL
  DetailPrint "[Installer] Checking ${LABEL}"
  System::Call 'kernel32::GetTickCount()i .r7'
  SetOutPath "$PLUGINSDIR"
  File /oname=component-${KEY}.version "${PROJECT_DIR}\build-tar\windows-components\${KEY}.version"
  File /oname=component-${KEY}.sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sha256"
  File /oname=component-${KEY}.sentinel-sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sentinel-sha256"

  FileOpen $2 "$PLUGINSDIR\component-${KEY}.version" r
  IfErrors ComponentVersionInvalid_${TOKEN}
  FileRead $2 $R1
  FileClose $2
  StrCpy $R1 $R1 64
  StrLen $R5 $R1
  IntCmp $R5 64 0 ComponentVersionInvalid_${TOKEN} ComponentVersionInvalid_${TOKEN}

  FileOpen $2 "$PLUGINSDIR\component-${KEY}.sha256" r
  IfErrors ComponentVersionInvalid_${TOKEN}
  FileRead $2 $R4
  FileClose $2
  StrCpy $R4 $R4 64
  StrLen $R5 $R4
  IntCmp $R5 64 0 ComponentVersionInvalid_${TOKEN} ComponentVersionInvalid_${TOKEN}

  FileOpen $2 "$PLUGINSDIR\component-${KEY}.sentinel-sha256" r
  IfErrors ComponentVersionInvalid_${TOKEN}
  FileRead $2 $R6
  FileClose $2
  StrCpy $R6 $R6 64
  StrLen $R5 $R6
  IntCmp $R5 64 0 ComponentVersionInvalid_${TOKEN} ComponentVersionInvalid_${TOKEN}

  StrCpy $R2 "$LOCALAPPDATA\ZhiYuanAgent\runtimes\${KEY}\$R1"
  IfFileExists "$R2\.complete" 0 ComponentCacheMiss_${TOKEN}
  FileOpen $2 "$R2\.complete" r
  IfErrors ComponentCacheMiss_${TOKEN}
  FileRead $2 $R5
  FileClose $2
  StrCpy $R5 $R5 64
  StrCmp $R5 $R1 0 ComponentCacheMiss_${TOKEN}
  IfFileExists "$R2\${SENTINEL}" 0 ComponentCacheMiss_${TOKEN}
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "(Get-FileHash -LiteralPath \"$R2\${SENTINEL}\" -Algorithm SHA256).Hash.ToLowerInvariant()"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 ComponentCacheMiss_${TOKEN}
  StrCpy $1 $1 64
  StrCmp $1 $R6 ComponentCacheHit_${TOKEN} ComponentCacheMiss_${TOKEN}

  ComponentCacheHit_${TOKEN}:
    DetailPrint "[Installer] Reusing ${LABEL}"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-cache-hit component=${KEY} content_id=$R1$\r$\n"
    FileClose $2
    Goto ComponentReady_${TOKEN}

  ComponentCacheMiss_${TOKEN}:
    DetailPrint "[Installer] Expanding ${LABEL}"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-cache-miss component=${KEY} content_id=$R1$\r$\n"
    FileClose $2
    StrCpy $R3 "$LOCALAPPDATA\ZhiYuanAgent\runtimes\${KEY}\$R1.installing"
    RMDir /r "$R3"
    CreateDirectory "$R3"
    SetOutPath "$PLUGINSDIR"
    File /oname=component-${KEY}.tar "${PROJECT_DIR}\build-tar\windows-components\${KEY}.tar"

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "(Get-FileHash -LiteralPath \"$PLUGINSDIR\component-${KEY}.tar\" -Algorithm SHA256).Hash.ToLowerInvariant()"'
    Pop $0
    Pop $1
    StrCmp $0 "0" 0 ComponentHashFailed_${TOKEN}
    StrCpy $1 $1 64
    StrCmp $1 $R4 0 ComponentHashFailed_${TOKEN}

    nsExec::ExecToStack '"$SYSDIR\tar.exe" -xf "$PLUGINSDIR\component-${KEY}.tar" -C "$R3"'
    Pop $0
    Pop $1
    StrCmp $0 "error" ComponentExtractFailed_${TOKEN}
    IntCmp $0 0 ComponentExtracted_${TOKEN} ComponentExtractFailed_${TOKEN} ComponentExtractFailed_${TOKEN}

  ComponentHashFailed_${TOKEN}:
    StrCpy $R9 "${LABEL} 归档 SHA-256 校验失败，安装包可能不完整。"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-hash-failed component=${KEY} expected=$R4 actual=$1 exit=$0$\r$\n"
    FileClose $2
    Goto OfflineComponentInstallFailed

  ComponentExtractFailed_${TOKEN}:
    StrCpy $R9 "${LABEL} 展开失败（代码 $0）。请检查磁盘空间或安全软件后重试。"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-extract-failed component=${KEY} exit=$0 output=$1$\r$\n"
    FileClose $2
    Goto OfflineComponentInstallFailed

  ComponentExtracted_${TOKEN}:
    IfFileExists "$R3\${SENTINEL}" 0 ComponentVerificationFailed_${TOKEN}
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "(Get-FileHash -LiteralPath \"$R3\${SENTINEL}\" -Algorithm SHA256).Hash.ToLowerInvariant()"'
    Pop $0
    Pop $1
    StrCmp $0 "0" 0 ComponentVerificationFailed_${TOKEN}
    StrCpy $1 $1 64
    StrCmp $1 $R6 0 ComponentVerificationFailed_${TOKEN}
    FileOpen $2 "$R3\.complete" w
    FileWrite $2 "$R1|$R4"
    FileClose $2
    RMDir /r "$R2"
    Rename "$R3" "$R2"
    IfErrors ComponentCommitFailed_${TOKEN}
    Delete "$PLUGINSDIR\component-${KEY}.tar"
    Goto ComponentReady_${TOKEN}

  ComponentVerificationFailed_${TOKEN}:
    StrCpy $R9 "${LABEL} 健康检查失败，${SENTINEL} 缺失或校验不匹配。"
    Goto OfflineComponentInstallFailed

  ComponentCommitFailed_${TOKEN}:
    StrCpy $R9 "无法启用 ${LABEL}，请确认当前用户对 %LOCALAPPDATA%\ZhiYuanAgent 有写入权限。"
    Goto OfflineComponentInstallFailed

  ComponentVersionInvalid_${TOKEN}:
    StrCpy $R9 "安装包缺少 ${LABEL} 的有效版本或校验信息。"
    Goto OfflineComponentInstallFailed

  ComponentReady_${TOKEN}:
    FileOpen $2 "$PLUGINSDIR\component-targets.txt" a
    ; Keep the 64-character content ID in its dedicated version file. Combining
    ; it with the routing fields can split the skill-python row in NSIS builds.
    FileWrite $2 "${KEY}|${PREFIX}$\r$\n"
    FileClose $2
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $R5 $6 - $7
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-ready component=${KEY} content_id=$R1 elapsed_ms=$R5$\r$\n"
    FileClose $2
!macroend

!macro customInstall
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  CreateDirectory "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
  SetOutPath "$PLUGINSDIR"
  !insertmacro ExtractElevatedActionScript
  FileOpen $2 "$PLUGINSDIR\component-targets.txt" w
  FileClose $2
  Delete "$PLUGINSDIR\component-switch-state.txt"

  ; Defender exclusion is optional and requires explicit, informed consent.
  ; Keep the scope limited to the immutable component cache; never exclude
  ; user-created Skills, OpenClaw state, model data, or the full install tree.
  DetailPrint "[Installer] Checking Microsoft Defender exclusion"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    try {\
      $$excluded = @((Get-MpPreference -ErrorAction Stop).ExclusionPath);\
      if ($$excluded -contains $$runtimeRoot) { exit 0 }\
    } catch { };\
    exit 3"'
  Pop $0
  Pop $1
  StrCmp $0 "0" DefenderExclusionAlreadyActive
  IfSilent DefenderExclusionSkipped
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "是否允许将知远的离线运行环境加入 Microsoft Defender 排除项？$\r$\n$\r$\n这样可以显著减少大量小文件在首次解压和后续运行时的扫描开销，但该目录中的文件将不再接受 Defender 实时扫描。设置会持续到卸载知远，你也可以随时在 Windows 安全中心撤销。$\r$\n$\r$\n目录：%LOCALAPPDATA%\ZhiYuanAgent\runtimes$\r$\n$\r$\n开源版推荐选择“是”；如不希望修改 Defender 设置，请选择“否”。" IDYES EnableDefenderExclusion IDNO DefenderExclusionDeclined

  EnableDefenderExclusion:
    DetailPrint "[Installer] Adding user-approved Defender exclusion"
    !insertmacro RunElevatedAction ADD_DEFENDER add-defender-exclusion "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
    StrCmp $0 "0" DefenderExclusionEnabled
      Delete "$APPDATA\ZhiYuanAgent\defender-exclusion-managed"
      FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
      FileWrite $2 "phase=defender-exclusion-failed exit=$0 output=$1$\r$\n"
      FileClose $2
      MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Defender 排除项未能添加。可能是你取消了管理员授权，或系统安全策略不允许修改。知远仍会继续安装。"
      Goto DefenderExclusionDone

  DefenderExclusionEnabled:
    FileOpen $2 "$APPDATA\ZhiYuanAgent\defender-exclusion-managed" w
    FileWrite $2 "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
    FileClose $2
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=defender-exclusion-enabled path=$LOCALAPPDATA\ZhiYuanAgent\runtimes$\r$\n"
    FileClose $2
    Goto DefenderExclusionDone

  DefenderExclusionAlreadyActive:
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=defender-exclusion-already-active path=$LOCALAPPDATA\ZhiYuanAgent\runtimes$\r$\n"
    FileClose $2
    Goto DefenderExclusionDone

  DefenderExclusionDeclined:
    Delete "$APPDATA\ZhiYuanAgent\defender-exclusion-managed"
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=defender-exclusion-declined$\r$\n"
    FileClose $2
    Goto DefenderExclusionDone

  DefenderExclusionSkipped:
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=defender-exclusion-skipped-silent$\r$\n"
    FileClose $2

  DefenderExclusionDone:

  !insertmacro EnsureOfflineComponent OPENCLAW "openclaw" "cfmind" "cfmind\package.json" "OpenClaw 离线运行环境"
  !insertmacro EnsureOfflineComponent SKILLS "skills" "SKILLs" "SKILLs\skills.config.json" "内置 Skills"
  !insertmacro EnsureOfflineComponent MCPS "mcps" "MCPs" "MCPs\compatibility-review.md" "内置 MCPs"
  !insertmacro EnsureOfflineComponent PORTABLE_GIT "portable-git" "mingit" "mingit\usr\bin\bash.exe" "PortableGit"
  !insertmacro EnsureOfflineComponent PYTHON "python" "python-win" "python-win\python.exe" "Python 离线运行环境"
  !insertmacro EnsureOfflineComponent SKILL_PYTHON "skill-python" "skill-python" "skill-python\xlsx\Scripts\python.exe" "Skill Python 离线环境"
  !insertmacro EnsureOfflineComponent UV "uv" "uv-win" "uv-win\uv.exe" "uv 离线运行环境"

  DetailPrint "[Installer] Activating offline components"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    $$statePath = \"$PLUGINSDIR\component-switch-state.txt\";\
    $$rows = @(Get-Content -LiteralPath \"$PLUGINSDIR\component-targets.txt\" | Where-Object { $$_ } | ForEach-Object {\
      $$parts = $$_.Split(\"|\");\
      if ($$parts.Count -ne 2 -or -not $$parts[0] -or -not $$parts[1]) { throw \"Invalid component target row: $$_\" };\
      $$idPath = Join-Path \"$PLUGINSDIR\" (\"component-\" + $$parts[0] + \".version\");\
      $$id = (Get-Content -LiteralPath $$idPath -Raw -ErrorAction Stop).Trim();\
      if ($$id -notmatch \"^[0-9a-f]{64}\z\") { throw \"Invalid component content ID for \" + $$parts[0] };\
      [pscustomobject]@{ Key = $$parts[0]; Prefix = $$parts[1]; Id = $$id }\
    });\
    $$prepared = @();\
    $$switched = @();\
    try {\
      foreach ($$row in $$rows) {\
        $$root = Join-Path $$runtimeRoot $$row.Key;\
        $$target = Join-Path $$root $$row.Id;\
        $$current = Join-Path $$root \"current\";\
        $$next = Join-Path $$root \"current.next\";\
        $$previous = Join-Path $$root \"current.previous\";\
        if ((Test-Path -LiteralPath $$previous) -and -not (Test-Path -LiteralPath $$current)) { Rename-Item -LiteralPath $$previous -NewName \"current\" };\
        foreach ($$stale in @($$next, $$previous)) {\
          if (Test-Path -LiteralPath $$stale) {\
            $$item = Get-Item -LiteralPath $$stale -Force;\
            if (($$item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw \"Unsafe component pointer: $$stale\" };\
            [IO.Directory]::Delete($$stale)\
          }\
        };\
        if (-not (Test-Path -LiteralPath $$target -PathType Container)) { throw \"Missing component version: $$target\" };\
        New-Item -ItemType Junction -Path $$next -Target $$target -Force -ErrorAction Stop | Out-Null;\
        $$prepared += [pscustomobject]@{ Row = $$row; Current = $$current; Next = $$next; Previous = $$previous }\
      };\
      foreach ($$entry in $$prepared) {\
        $$hadCurrent = Test-Path -LiteralPath $$entry.Current;\
        Add-Content -LiteralPath $$statePath -Value ($$entry.Row.Key + \"|\" + $$hadCurrent);\
        $$switched += [pscustomobject]@{ Entry = $$entry; HadCurrent = $$hadCurrent };\
        if ($$hadCurrent) { Rename-Item -LiteralPath $$entry.Current -NewName \"current.previous\" -ErrorAction Stop };\
        Rename-Item -LiteralPath $$entry.Next -NewName \"current\" -ErrorAction Stop\
      }\
    } catch {\
      foreach ($$entry in $$prepared) {\
        if (Test-Path -LiteralPath $$entry.Next) { [IO.Directory]::Delete($$entry.Next) }\
      };\
      [array]::Reverse($$switched);\
      foreach ($$switch in $$switched) {\
        $$entry = $$switch.Entry;\
        if (Test-Path -LiteralPath $$entry.Previous) {\
          if (Test-Path -LiteralPath $$entry.Current) { [IO.Directory]::Delete($$entry.Current) };\
          Rename-Item -LiteralPath $$entry.Previous -NewName \"current\"\
        } elseif (-not $$switch.HadCurrent -and (Test-Path -LiteralPath $$entry.Current)) {\
          [IO.Directory]::Delete($$entry.Current)\
        }\
      };\
      Remove-Item -LiteralPath $$statePath -Force -ErrorAction SilentlyContinue;\
      throw\
    }"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentPointersReady
    StrCpy $R9 "离线组件切换失败：$1"
    Goto OfflineComponentInstallFailed
  ComponentPointersReady:

  DetailPrint "[Installer] Connecting bundled runtimes"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$resourceRoot = \"$INSTDIR\resources\";\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    $$rows = @(Get-Content -LiteralPath \"$PLUGINSDIR\component-targets.txt\" | Where-Object { $$_ } | ForEach-Object { $$parts = $$_.Split(\"|\"); [pscustomobject]@{ Key = $$parts[0]; Prefix = $$parts[1] } });\
    foreach ($$row in $$rows) {\
      $$link = Join-Path $$resourceRoot $$row.Prefix;\
      $$target = Join-Path (Join-Path (Join-Path $$runtimeRoot $$row.Key) \"current\") $$row.Prefix;\
      if (-not (Test-Path -LiteralPath $$target)) { throw \"Missing component target: $$target\" };\
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
    StrCpy $R9 "离线运行环境连接失败：$1"
    Goto OfflineComponentInstallFailed
  RuntimeLinksReady:

  DetailPrint "[Installer] Verifying bundled runtimes"
  IfFileExists "$INSTDIR\resources\python-win\python.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\uv-win\uv.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\cfmind\package.json" 0 InstalledRuntimeVerificationFailed
  Goto OfflineComponentsReady
  InstalledRuntimeVerificationFailed:
    StrCpy $R9 "离线运行环境连接校验失败。请重新运行安装器。"
    Goto OfflineComponentInstallFailed

  OfflineComponentInstallFailed:
    nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
      $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
      $$statePath = \"$PLUGINSDIR\component-switch-state.txt\";\
      if (Test-Path -LiteralPath $$statePath) {\
        $$states = @(Get-Content -LiteralPath $$statePath | Where-Object { $$_ });\
        [array]::Reverse($$states);\
        foreach ($$state in $$states) {\
          $$parts = $$state.Split(\"|\");\
          $$root = Join-Path $$runtimeRoot $$parts[0];\
          $$current = Join-Path $$root \"current\";\
          $$previous = Join-Path $$root \"current.previous\";\
          if ($$parts[1] -eq \"True\") {\
            if (Test-Path -LiteralPath $$previous) {\
              if (Test-Path -LiteralPath $$current) { [IO.Directory]::Delete($$current) };\
              Rename-Item -LiteralPath $$previous -NewName \"current\"\
            }\
          } elseif (Test-Path -LiteralPath $$current) {\
            [IO.Directory]::Delete($$current)\
          }\
        }\
      }"'
    Pop $0
    FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
    FileWrite $2 "phase=component-set-rollback reason=$R9$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONSTOP "$R9"
    Abort

  OfflineComponentsReady:

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
    !insertmacro RunElevatedAction INSTALL_VC install-vc-runtime "$INSTDIR\resources\vc_redist.x64.exe"
    StrCmp $0 "0" VcRuntimeReady
    StrCmp $0 "1638" VcRuntimeReady
    StrCmp $0 "3010" VcRuntimeReady
      FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
      FileWrite $2 "phase=vc-runtime-install-failed exit=$0 output=$1$\r$\n"
      FileClose $2
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

  DetailPrint "[Installer] Cleaning unused offline component versions"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    $$rows = @(Get-Content -LiteralPath \"$PLUGINSDIR\component-targets.txt\" | Where-Object { $$_ } | ForEach-Object {\
      $$parts = $$_.Split(\"|\");\
      if ($$parts.Count -ne 2 -or -not $$parts[0]) { throw \"Invalid component target row: $$_\" };\
      $$idPath = Join-Path \"$PLUGINSDIR\" (\"component-\" + $$parts[0] + \".version\");\
      $$id = (Get-Content -LiteralPath $$idPath -Raw -ErrorAction Stop).Trim();\
      if ($$id -notmatch \"^[0-9a-f]{64}\z\") { throw \"Invalid component content ID for \" + $$parts[0] };\
      [pscustomobject]@{ Key = $$parts[0]; Id = $$id }\
    });\
    foreach ($$row in $$rows) {\
      $$root = Join-Path $$runtimeRoot $$row.Key;\
      foreach ($$pointerName in @(\"current.previous\", \"current.next\")) {\
        $$pointer = Join-Path $$root $$pointerName;\
        if (Test-Path -LiteralPath $$pointer) {\
          $$item = Get-Item -LiteralPath $$pointer -Force;\
          if (($$item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($$pointer) }\
        }\
      };\
      Get-ChildItem -LiteralPath $$root -Directory -ErrorAction SilentlyContinue | Where-Object { $$_.Name -ne $$row.Id -and $$_.Name -ne \"current\" } | ForEach-Object {\
        if (($$_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($$_.FullName) } else { Remove-Item -LiteralPath $$_.FullName -Recurse -Force }\
      }\
    };\
    $$legacy = \"$LOCALAPPDATA\ZhiYuanAgent\runtime-packs\";\
    if (Test-Path -LiteralPath $$legacy) {\
      $$legacyItem = Get-Item -LiteralPath $$legacy -Force;\
      if (($$legacyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($$legacy) } else { Remove-Item -LiteralPath $$legacy -Recurse -Force }\
    }"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $2 "phase=component-cleanup-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $2
  Delete "$PLUGINSDIR\component-switch-state.txt"

  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors InstallTimingDone
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileWrite $2 "phase=install-complete total_ms=$R6 component_set=ready$\r$\n"
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
  ; Remove component junctions before recursively deleting application-owned
  ; immutable data. User-created Skills and models remain under userData.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    if (Test-Path -LiteralPath $$runtimeRoot) {\
      Get-ChildItem -LiteralPath $$runtimeRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {\
        foreach ($$pointerName in @(\"current\", \"current.next\", \"current.previous\")) {\
          $$pointer = Join-Path $$_.FullName $$pointerName;\
          if (Test-Path -LiteralPath $$pointer) {\
            $$pointerItem = Get-Item -LiteralPath $$pointer -Force;\
            if (($$pointerItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($$pointer) }\
          }\
        }\
      };\
      Remove-Item -LiteralPath $$runtimeRoot -Recurse -Force\
    };\
    $$legacyRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtime-packs\";\
    if (Test-Path -LiteralPath $$legacyRoot) { Remove-Item -LiteralPath $$legacyRoot -Recurse -Force }"'
  Pop $0

  ; Remove only exclusions that this installer recorded as user-approved and
  ; installer-managed. Never remove an exclusion created independently.
  IfFileExists "$APPDATA\ZhiYuanAgent\defender-exclusion-managed" 0 DefenderExclusionUninstallDone
    !insertmacro ExtractElevatedActionScript
    !insertmacro RunElevatedAction REMOVE_DEFENDER remove-defender-exclusion "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
    StrCmp $0 "0" 0 DefenderExclusionUninstallDone
      Delete "$APPDATA\ZhiYuanAgent\defender-exclusion-managed"
  DefenderExclusionUninstallDone:
!macroend
