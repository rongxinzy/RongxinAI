!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define ELEVATED_ACTION_SCRIPT "nsis-elevated-actions.ps1"
!define ELEVATED_ACTION_RESULT "elevated-action-result.txt"

; electron-builder compiles the uninstaller before the installer. Its assisted
; template does not insert installation pages while BUILD_UNINSTALLER is set,
; so keep the page state and callbacks out of that compilation pass.
!ifndef BUILD_UNINSTALLER
Var /GLOBAL installLocalInference
Var /GLOBAL localInferenceDialog
Var /GLOBAL localInferenceCheckbox
Var /GLOBAL localInferenceLabel

!macro OpenTimingLogForAppend HANDLE
  ; NSIS append mode preserves existing data but starts at offset zero.
  FileOpen ${HANDLE} "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileSeek ${HANDLE} 0 END
!macroend

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
  ; processes are used only for the VC++ runtime installer below.
  RequestExecutionLevel user
  ShowInstDetails nevershow
  ; NSIS startup CRC check reads the entire installer before the UI appears.
  ; Every payload is already covered by per-component SHA-256 and 7z CRC, so
  ; the extra full-file scan is redundant and slow for a multi-gigabyte exe.
  CRCCheck off
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用知远智能体"
  !define MUI_WELCOMEPAGE_TEXT "安装程序将在本地准备离线运行环境，完成后即可使用。本地推理组件可在首次启动后按需下载。$\r$\n$\r$\n点击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

Function LocalInferencePageCreate
  ; electron-builder prepends this script before installer.nsi includes
  ; MUI2.nsh, so the MUI_HEADER_TEXT macro is undefined at compile time.
  ; Set the standard MUI header controls (IDs 1037/1038) directly instead.
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:本地推理组件"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:按需启用本地模型推理"
  nsDialogs::Create 1018
  Pop $localInferenceDialog
  ${If} $localInferenceDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "开启后，首次启动时会根据你的硬件下载 CPU 或 NVIDIA CUDA 后端（约 16 MB–621 MB）。"
  Pop $localInferenceLabel

  ${NSD_CreateLabel} 0 36u 100% 16u "不勾选不会影响其他功能。"
  Pop $localInferenceLabel

  ${NSD_CreateCheckbox} 0 80u 100% 12u "安装本地推理组件"
  Pop $localInferenceCheckbox
  ; Preserve the previous MessageBox default (No) by leaving the box unchecked.
  ${NSD_SetState} $localInferenceCheckbox ${BST_UNCHECKED}

  nsDialogs::Show
FunctionEnd

Function LocalInferencePageLeave
  ${NSD_GetState} $localInferenceCheckbox $installLocalInference
FunctionEnd

!macro customPageAfterChangeDir
  Page custom LocalInferencePageCreate LocalInferencePageLeave
!macroend
!endif

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
  !insertmacro OpenTimingLogForAppend $8
  FileWrite $8 "phase=process-stop-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $8

  DetailPrint "[Installer] Migrating user-created Skills"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$source = \"$INSTDIR\resources\SKILLs\";\
    $$destination = \"$APPDATA\ZhiYuanAgent\SKILLs\";\
    $$config = Join-Path $$source \"skills.config.json\";\
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
  !insertmacro OpenTimingLogForAppend $8
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
  !insertmacro OpenTimingLogForAppend $8
  FileWrite $8 "phase=old-install-detached elapsed_ms=$5 path=$3$\r$\n"
  FileClose $8
!macroend

!macro StageOfflineComponentMetadata KEY
  SetOutPath "$PLUGINSDIR"
  File /oname=component-${KEY}.version "${PROJECT_DIR}\build-tar\windows-components\${KEY}.version"
  File /oname=component-${KEY}.sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sha256"
  File /oname=component-${KEY}.sentinel-sha256 "${PROJECT_DIR}\build-tar\windows-components\${KEY}.sentinel-sha256"
!macroend

!macro QueueOfflineComponent TOKEN KEY LABEL
  DetailPrint "[Installer] Checking ${LABEL}"
  System::Call 'kernel32::GetTickCount()i .r7'
  IfFileExists "$PLUGINSDIR\component-${KEY}.cache-valid" ComponentCacheHit_${TOKEN} ComponentCacheMiss_${TOKEN}
  ComponentCacheHit_${TOKEN}:
    DetailPrint "[Installer] Reusing ${LABEL}"
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-cache-hit component=${KEY}$\r$\n"
    FileClose $2
    Goto ComponentQueued_${TOKEN}

  ComponentCacheMiss_${TOKEN}:
    DetailPrint "[Installer] Expanding ${LABEL}"
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-cache-miss component=${KEY}$\r$\n"
    FileClose $2
    SetOutPath "$PLUGINSDIR"
    SetCompress off
    File /oname=component-${KEY}.7z "${PROJECT_DIR}\build-tar\windows-components\${KEY}.7z"
    SetCompress auto
  ComponentQueued_${TOKEN}:
!macroend

!macro RecordOfflineComponentReady KEY
  FileOpen $2 "$PLUGINSDIR\component-${KEY}.version" r
  IfErrors OfflineComponentInstallFailed
  FileRead $2 $R1
  FileClose $2
  StrCpy $R1 $R1 64
    !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=component-ready component=${KEY} content_id=$R1 validation=batch$\r$\n"
    FileClose $2
!macroend

!macro customInstall
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  CreateDirectory "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
  SetOutPath "$PLUGINSDIR"
  !insertmacro ExtractElevatedActionScript
  File /oname=7za.exe "${PROJECT_DIR}\node_modules\7zip-bin\win\x64\7za.exe"
  File /oname=7za.sha256 "${PROJECT_DIR}\build-tar\windows-components\7za.sha256"
  File /oname=component-manifest.json "${PROJECT_DIR}\build-tar\windows-components\manifest.json"
  File /oname=recover-component-switch.ps1 "${PROJECT_DIR}\scripts\installer\recover-component-switch.ps1"
  File /oname=validate-offline-components.ps1 "${PROJECT_DIR}\scripts\installer\validate-offline-components.ps1"
  ; Embed the routing table as a compile-time asset. Building it incrementally
  ; with NSIS FileWrite can split the skill-python key on Windows runners.
  File /oname=component-targets.json "${PROJECT_DIR}\scripts\nsis-offline-components.json"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "(Get-FileHash -LiteralPath \"$PLUGINSDIR\7za.exe\" -Algorithm SHA256).Hash.ToLowerInvariant()"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 OfflineComponentInstallFailed
  FileOpen $2 "$PLUGINSDIR\7za.sha256" r
  IfErrors OfflineComponentInstallFailed
  FileRead $2 $R7
  FileClose $2
  StrCpy $R7 $R7 64
  StrCpy $1 $1 64
  StrCmp $1 $R7 0 OfflineComponentInstallFailed
  ; Keep the journal in the persistent cache: $PLUGINSDIR is deleted after a forced quit.
  ; A separate script avoids NSIS macro expansion corrupting PowerShell quotes.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\recover-component-switch.ps1" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 OfflineComponentInstallFailed

  !insertmacro StageOfflineComponentMetadata "channel-runtime"
  !insertmacro StageOfflineComponentMetadata "skills"
  !insertmacro StageOfflineComponentMetadata "mcps"
  !insertmacro StageOfflineComponentMetadata "portable-git"
  !insertmacro StageOfflineComponentMetadata "python"
  !insertmacro StageOfflineComponentMetadata "skill-python"
  !insertmacro StageOfflineComponentMetadata "uv"

  ; Verify all reusable cache entries in one PowerShell process before deciding
  ; which archives NSIS needs to unpack from the installer.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode cache -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentCacheValidated
    StrCpy $R9 "安装包缺少有效离线组件校验信息：$1"
    Goto OfflineComponentInstallFailed
  ComponentCacheValidated:

  !insertmacro QueueOfflineComponent CHANNEL_RUNTIME "channel-runtime" "频道运行环境"
  !insertmacro QueueOfflineComponent SKILLS "skills" "内置 Skills"
  !insertmacro QueueOfflineComponent MCPS "mcps" "内置 MCPs"
  !insertmacro QueueOfflineComponent PORTABLE_GIT "portable-git" "PortableGit"
  !insertmacro QueueOfflineComponent PYTHON "python" "Python 离线运行环境"
  !insertmacro QueueOfflineComponent SKILL_PYTHON "skill-python" "Skill Python dependency layer"
  !insertmacro QueueOfflineComponent UV "uv" "uv 离线运行环境"

  ; The changed archives are now present in $PLUGINSDIR. Validate their hashes,
  ; entries and sentinels, then extract them in one PowerShell batch. This keeps
  ; cache hits fast while eliminating a PowerShell startup per component.
  DetailPrint "[Installer] Validating and expanding offline components"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode expand -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentBatchExpanded
  StrCmp $0 "2" ComponentBatchHashFailed
  StrCmp $0 "3" ComponentBatchArchiveUnsafe
  StrCmp $0 "4" ComponentBatchExtractFailed
  StrCmp $0 "5" ComponentBatchVerificationFailed
    StrCpy $R9 "离线组件批处理失败：$1"
    Goto OfflineComponentInstallFailed

  ComponentBatchHashFailed:
    StrCpy $R9 "离线组件归档 SHA-256 校验失败，安装包可能不完整。"
    Goto OfflineComponentInstallFailed
  ComponentBatchArchiveUnsafe:
    StrCpy $R9 "离线组件归档包含不安全路径或链接元数据。"
    Goto OfflineComponentInstallFailed
  ComponentBatchExtractFailed:
    StrCpy $R9 "离线组件展开失败。请检查磁盘空间或安全软件后重试。"
    Goto OfflineComponentInstallFailed
  ComponentBatchVerificationFailed:
    StrCpy $R9 "离线组件健康检查失败，哨兵文件缺失或校验不匹配。"
    Goto OfflineComponentInstallFailed
  ComponentBatchExpanded:

  !insertmacro RecordOfflineComponentReady "channel-runtime"
  !insertmacro RecordOfflineComponentReady "skills"
  !insertmacro RecordOfflineComponentReady "mcps"
  !insertmacro RecordOfflineComponentReady "portable-git"
  !insertmacro RecordOfflineComponentReady "python"
  !insertmacro RecordOfflineComponentReady "skill-python"
  !insertmacro RecordOfflineComponentReady "uv"

  DetailPrint "[Installer] Activating offline components"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$ErrorActionPreference = \"Stop\";\
    Set-StrictMode -Version Latest;\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    $$statePath = Join-Path $$runtimeRoot \"component-switch-state.txt\";\
    $$manifest = Get-Content -LiteralPath \"$PLUGINSDIR\component-manifest.json\" -Raw | ConvertFrom-Json;\
    $$targets = @((Get-Content -LiteralPath \"$PLUGINSDIR\component-targets.json\" -Raw -ErrorAction Stop | ConvertFrom-Json));\
    $$rows = @($$targets | ForEach-Object {\
      $$targetRow = $$_;\
      if ($$targetRow.key -notmatch \"^[a-z0-9-]+\z\" -or $$targetRow.prefix -notmatch \"^[A-Za-z0-9-]+\z\") { throw \"Invalid component target entry\" };\
      $$idPath = Join-Path \"$PLUGINSDIR\" (\"component-\" + $$targetRow.key + \".version\");\
      $$id = (Get-Content -LiteralPath $$idPath -Raw -ErrorAction Stop).Trim();\
      if ($$id -notmatch \"^[0-9a-f]{64}\z\") { throw \"Invalid component content ID for \" + $$targetRow.key };\
      $$manifestEntry = @($$manifest.components | Where-Object { $$_.key -eq $$targetRow.key });\
      if ($$manifestEntry.Count -ne 1 -or $$manifestEntry[0].prefix -ne $$targetRow.prefix -or $$manifestEntry[0].contentId -ne $$id) { throw \"Component manifest mismatch: $$($$targetRow.key)\" };\
      [pscustomobject]@{ Key = [string]$$targetRow.key; Prefix = [string]$$targetRow.prefix; Id = $$id }\
    });\
    $$prepared = @();\
    $$switched = @();\
    try {\
      if ($$rows.Count -ne 7) { throw \"Invalid component manifest: expected 7 components, got $$($$rows.Count)\" };\
      if (@($$rows.Key | Sort-Object -Unique).Count -ne 7) { throw \"Invalid component manifest: duplicate component key\" };\
      foreach ($$row in $$rows) {\
        $$root = Join-Path $$runtimeRoot $$row.Key;\
        $$target = Join-Path $$root $$row.Id;\
        $$complete = Join-Path $$target \".complete\";\
        if (-not (Test-Path -LiteralPath $$target) -or -not (Test-Path -LiteralPath $$complete)) { throw \"Missing prepared component target: $$target\" };\
        $$completeId = (Get-Content -LiteralPath $$complete -Raw).Substring(0, 64);\
        if ($$completeId -ne $$row.Id) { throw \"Prepared component id mismatch: $$($$row.Key)\" };\
        $$current = Join-Path $$root \"current\";\
        $$next = Join-Path $$root \"current.next\";\
        $$previous = Join-Path $$root \"current.previous\";\
        if ((Test-Path -LiteralPath $$previous) -and -not (Test-Path -LiteralPath $$current)) { Rename-Item -LiteralPath $$previous -NewName \"current\" -ErrorAction Stop };\
        foreach ($$stale in @($$next, $$previous)) {\
          if (Test-Path -LiteralPath $$stale) {\
            $$item = Get-Item -LiteralPath $$stale -Force;\
            if (($$item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw \"Unsafe component pointer: $$stale\" };\
            [IO.Directory]::Delete($$stale)\
          }\
        };\
        New-Item -ItemType Junction -Path $$next -Target $$target -Force -ErrorAction Stop | Out-Null;\
        if (-not (Test-Path -LiteralPath $$next)) { throw \"Failed to prepare component junction: $$next\" };\
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
    $$ErrorActionPreference = \"Stop\";\
    Set-StrictMode -Version Latest;\
    $$resourceRoot = \"$INSTDIR\resources\";\
    $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
    $$manifest = Get-Content -LiteralPath \"$PLUGINSDIR\component-manifest.json\" -Raw | ConvertFrom-Json;\
    $$rows = @($$manifest.components | ForEach-Object { [pscustomobject]@{ Key = [string]$$_.key; Prefix = [string]$$_.prefix } });\
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
      New-Item -ItemType Junction -Path $$link -Target $$target -Force -ErrorAction Stop | Out-Null;\
    }"'
  Pop $0
  Pop $1
  StrCmp $0 "0" RuntimeLinksReady
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=runtime-link-failed exit=$0 output=$1$\r$\n"
    FileClose $2
    StrCpy $R9 "离线运行环境连接失败：$1"
    Goto OfflineComponentInstallFailed
  RuntimeLinksReady:

  DetailPrint "[Installer] Verifying bundled runtimes"
  IfFileExists "$INSTDIR\resources\python-win\python.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\uv-win\uv.exe" 0 InstalledRuntimeVerificationFailed
  IfFileExists "$INSTDIR\resources\channel-runtime\cc-connect-sidecar.exe" 0 InstalledRuntimeVerificationFailed
  Goto OfflineComponentsReady
  InstalledRuntimeVerificationFailed:
    StrCpy $R9 "离线运行环境连接校验失败。请重新运行安装器。"
    Goto OfflineComponentInstallFailed

  OfflineComponentInstallFailed:
    nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
      $$runtimeRoot = \"$LOCALAPPDATA\ZhiYuanAgent\runtimes\";\
      $$statePath = Join-Path $$runtimeRoot \"component-switch-state.txt\";\
      if (Test-Path -LiteralPath $$statePath) {\
        $$states = @(Get-Content -LiteralPath $$statePath | Where-Object { $$_ -match \"^[^=|]+\\|(?:True|False)\\z\" });\
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
    !insertmacro OpenTimingLogForAppend $2
    FileWrite $2 "phase=component-set-rollback reason=$R9$\r$\n"
    FileClose $2
    IfSilent OfflineComponentInstallFailedSilent 0
      MessageBox MB_OK|MB_ICONSTOP "$R9"
    OfflineComponentInstallFailedSilent:
    SetErrorLevel 1
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
      !insertmacro OpenTimingLogForAppend $2
      FileWrite $2 "phase=vc-runtime-install-failed exit=$0 output=$1$\r$\n"
      FileClose $2
      MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Visual C++ Runtime 未能自动安装。知远仍会完成安装，但部分本地组件可能暂时不可用。"
  VcRuntimeReady:

  ; Local inference remains optional. The user chose on the custom options page
  ; whether to prepare it; download, verification, extraction, cancellation and
  ; retry happen in-app.
  Delete "$APPDATA\ZhiYuanAgent\pending-local-inference-install"
  ${If} $installLocalInference == 1
    FileOpen $2 "$APPDATA\ZhiYuanAgent\pending-local-inference-install" w
    FileWrite $2 "$R1"
    FileClose $2
  ${EndIf}

  ; Cleanup begins only after core application and runtime links are ready, so
  ; it no longer competes with resource expansion on slow disks.
  DetailPrint "[Installer] Scheduling previous version cleanup"
  ; Remove known junctions explicitly before recursive deletion. This prevents
  ; an old installation cleanup from ever walking into an immutable shared pack.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    $$names = @("channel-runtime", "SKILLs", "MCPs", "mingit", "python-win", "skill-python", "uv-win");\
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
    $$manifest = Get-Content -LiteralPath \"$PLUGINSDIR\component-manifest.json\" -Raw | ConvertFrom-Json;\
    $$rows = @($$manifest.components | ForEach-Object { [pscustomobject]@{ Key = [string]$$_.key; Id = [string]$$_.contentId } });\
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
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=component-cleanup-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $2
  Delete "$LOCALAPPDATA\ZhiYuanAgent\runtimes\component-switch-state.txt"

  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors InstallTimingDone
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  !insertmacro OpenTimingLogForAppend $2
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
  ; Remove component junctions before detaching application-owned immutable
  ; data. User-created Skills and models remain under userData. Deleting the
  ; expanded runtime tree synchronously can take longer than the uninstaller
  ; itself, so rename it atomically and reclaim it in the background.
  ; Keep both the uninstaller and spawned cleanup commands outside $INSTDIR so
  ; electron-builder's final RMDir can remove the now-empty application root.
  SetOutPath "$TEMP"
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
      }\
    }"'
  Pop $0

  nsExec::ExecToLog 'cmd /c for /d %D in ("$LOCALAPPDATA\ZhiYuanAgent\runtimes.uninstall.*") do @start "" /b cmd /d /c rd /s /q "%~fD"'
  Pop $0
  StrCpy $3 "$LOCALAPPDATA\ZhiYuanAgent\runtimes"
  IfFileExists "$3\*.*" 0 RuntimeCleanupDone
    System::Call 'kernel32::GetTickCount()i .r4'
    StrCpy $4 "$3.uninstall.$4"
    ClearErrors
    Rename "$3" "$4"
    IfErrors RuntimeCleanupDetachFailed
      nsExec::ExecToLog 'cmd /c start "" /b cmd /d /c rd /s /q "$4"'
      Pop $0
      Goto RuntimeCleanupDone
    RuntimeCleanupDetachFailed:
      DetailPrint "[Uninstaller] Could not detach the offline runtime cache"
  RuntimeCleanupDone:
  RMDir "$3"

  nsExec::ExecToLog 'cmd /c for /d %D in ("$LOCALAPPDATA\ZhiYuanAgent\runtime-packs.uninstall.*") do @start "" /b cmd /d /c rd /s /q "%~fD"'
  Pop $0
  StrCpy $3 "$LOCALAPPDATA\ZhiYuanAgent\runtime-packs"
  IfFileExists "$3\*.*" 0 LegacyRuntimeCleanupDone
    System::Call 'kernel32::GetTickCount()i .r4'
    StrCpy $4 "$3.uninstall.$4"
    ClearErrors
    Rename "$3" "$4"
    IfErrors LegacyRuntimeCleanupDetachFailed
      nsExec::ExecToLog 'cmd /c start "" /b cmd /d /c rd /s /q "$4"'
      Pop $0
      Goto LegacyRuntimeCleanupDone
    LegacyRuntimeCleanupDetachFailed:
      DetailPrint "[Uninstaller] Could not detach the legacy runtime cache"
  LegacyRuntimeCleanupDone:
  RMDir "$3"

!macroend
