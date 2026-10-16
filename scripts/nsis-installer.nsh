!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!ifdef PROJECT_DIR
!include "${PROJECT_DIR}\scripts\installer-shell\retain-uninstaller.nsh"
!endif

; Fully custom-drawn installer UI (palette, drawing helpers, page functions
; and string table). The theme file carries the include guard. electron-builder
; compiles this file from its own NSIS staging directory (the header prepends
; it ahead of installer.nsi), so relative sibling includes would resolve
; against that staging directory and fail; PROJECT_DIR (always passed via -D)
; anchors them to the repository. The relative fallback serves direct local
; makensis runs from this script's directory.
; These two globals must be declared before the UI includes: ZYHeroLeave reads
; $installLocalInference and the PrepareExistingInstallForExtraction insertion
; expands $preparedInstallRoot while zy-pages.nsh is still being processed.
!ifndef BUILD_UNINSTALLER
Var /GLOBAL installLocalInference
Var /GLOBAL preparedInstallRoot
!endif
; Used by customUnInstall in the uninstaller pass to mirror uninstaller.nsh's
; delete-app-data decision for the real userData directory. Uninstaller pass
; only: in the installer pass the variable would be unused and -WX promotes
; makensis warning 6001 to an error.
!ifdef BUILD_UNINSTALLER
Var /GLOBAL zyDeleteRealAppData
!endif

; ---------------------------------------------------------------------------
; Macros consumed by the UI includes below. NSIS macros must be defined
; before their first insertion point: ZYHeroLeave (in zy-pages.nsh) inserts
; PrepareExistingInstallForExtraction while that file is still being
; processed, so these live ahead of the includes. StopAppProcesses,
; CountInstallDirProcesses and ForgetOldInstallRegistry stay available to
; the uninstaller pass; the timing-log helper and the extraction itself
; are installer-only.
; ---------------------------------------------------------------------------

; PrepareExistingInstallForExtraction is inserted from ZYHeroLeave (in the
; installer-ui/zy-pages.nsh include below) — ahead of multiUser.nsh, where
; electron-builder defines these keys with the same /ifndef fallback values.
; Mirror the defaults here so registry macros expand correctly at that
; earlier point.
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define /ifndef UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

; electron-builder's CHECK_APP_RUNNING treats any process whose image path
; starts with $INSTDIR as "app still running". Sidecars (cc-connect,
; llama-server, python, git) survive a force-killed main process, so kill by
; install-root/runtime-cache path prefix instead of by process name; otherwise
; orphaned sidecars keep the "cannot be closed" retry dialog up forever.
; The caller itself is excluded: an in-place uninstaller runs from $INSTDIR.
!macro StageInstallSafetyScripts
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=validate-install-root.ps1 "${PROJECT_DIR}\scripts\installer\validate-install-root.ps1"
  File /oname=manage-install-processes.ps1 "${PROJECT_DIR}\scripts\installer\manage-install-processes.ps1"
!macroend

!macro ValidateInstallRoot MODE
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-install-root.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -AppDataRoot "$APPDATA\ZhiYuanAgent" -Mode ${MODE}'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$(ZY_INSTALL_ROOT_INVALID)$\r$\n$1"
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

!macro StopAppProcesses
  System::Call 'kernel32::GetCurrentProcessId()i .r9'
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-install-processes.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -SelfPid $9 -Mode stop'
  Pop $0
  Pop $1
  DetailPrint "$1"
  ${If} $0 != "0"
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$(ZY_PROCESS_STOP_FAILED)$\r$\n$1"
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

; Exit status is the bounded process count; no stdout parsing is needed.
!macro CountInstallDirProcesses RESULT
  System::Call 'kernel32::GetCurrentProcessId()i .r9'
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-install-processes.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -SelfPid $9 -Mode count'
  Pop ${RESULT}
  Pop $R8
!macroend

; Replace stock CHECK_APP_RUNNING: its raw prefix/inline PowerShell path
; handling is unsafe. Silent un.onInit calls this before customUnInit, so it
; must stage its own helpers and validate before touching any process.
!macro customCheckAppRunning
  !insertmacro StageInstallSafetyScripts
  !ifdef BUILD_UNINSTALLER
    !insertmacro ValidateInstallRoot uninstall
  !else
    !insertmacro ValidateInstallRoot install
  !endif
  !insertmacro StopAppProcesses
!macroend

; electron-builder's uninstallOldVersion launches the previous uninstaller and
; treats any non-zero exit as "cannot be closed", retrying five times before
; quitting the install. The previous version is already detached (renamed
; away) here, so that uninstaller is redundant — and when the detach could not
; run, a locked file makes the old uninstaller exit with code 2, producing
; exactly that misleading dialog. Remove the old registration so
; uninstallOldVersion returns early; only entries pointing at $INSTDIR are
; touched, an installation in a different directory keeps its entry and is
; removed by electron-builder as usual.
!macro ForgetOldInstallRegistry TOKEN
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R7 "" ForgetOldInstallRegistry_Do_${TOKEN}
  StrCmp $R7 $INSTDIR ForgetOldInstallRegistry_Do_${TOKEN} ForgetOldInstallRegistry_Done_${TOKEN}
  ForgetOldInstallRegistry_Do_${TOKEN}:
    SetRegView 64
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
    SetRegView 32
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
    SetRegView 64
    !ifdef UNINSTALL_REGISTRY_KEY_2
      SetRegView 32
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
      DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
      SetRegView 64
    !endif
  ForgetOldInstallRegistry_Done_${TOKEN}:
!macroend

!ifndef BUILD_UNINSTALLER
!macro OpenTimingLogForAppend HANDLE
  ; NSIS append mode preserves existing data but starts at offset zero.
  FileOpen ${HANDLE} "$APPDATA\ZhiYuanAgent\install-timing.log" a
  FileSeek ${HANDLE} 0 END
!macroend

; Destructive pre-extraction steps: stop the running application, migrate
; user-created Skills, detach the previous installation. They must NOT run
; from .onInit — the wizard has not been shown yet, and a cancel on any page
; would leave the user with a killed app and a renamed install directory.
; Interactive installs run this when the options page is left (the user has
; committed to installing); silent installs (/S, e.g. the auto-updater) skip
; pages entirely, so .onInit invokes it directly. The prepared root is
; remembered so returning to the directory page and leaving again only
; re-runs the steps when the target directory actually changed.
!macro PrepareExistingInstallForExtraction TOKEN
  ${If} $preparedInstallRoot != $INSTDIR
    ; Ownership and filesystem boundaries are checked before any process is
    ; stopped, migration starts, or the existing directory is detached.
    !insertmacro ValidateInstallRoot install
    StrCpy $preparedInstallRoot $INSTDIR

    DetailPrint "[Installer] Stopping running 知远 processes"
    System::Call 'kernel32::GetTickCount()i .r7'
    !insertmacro StopAppProcesses
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=process-stop-complete elapsed_ms=$5 exit=$0$\r$\n"
    FileClose $8

    DetailPrint "[Installer] Migrating user-created Skills"
    System::Call 'kernel32::GetTickCount()i .r7'
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\migrate-user-skills.ps1" -Source "$INSTDIR\resources\SKILLs" -Destination "$APPDATA\ZhiYuanAgent\SKILLs"'
    Pop $0
    Pop $1
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=skill-migration-complete elapsed_ms=$5 exit=$0 output=$1$\r$\n"
    FileClose $8
    ${If} $0 != "0"
      ; Do not detach or unregister the old application until every missing
      ; user-created Skill file has been preserved. Retrying resumes safely.
      IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "$(ZY_SKILL_MIGRATION_FAILED)$\r$\n$1"
      SetErrorLevel 1
      Quit
    ${EndIf}

    ; Rename the old application quickly. Its directory junctions do not copy the
    ; shared resource pack, and physical cleanup is delayed until installation ends.
    DetailPrint "[Installer] Detaching previous application version"
    System::Call 'kernel32::GetTickCount()i .r7'
    OldInstallDetachRetry_${TOKEN}:
    ${If} ${FileExists} "$INSTDIR\*.*"
      System::Call 'kernel32::GetTickCount()i .r4'
      StrCpy $3 "$INSTDIR.old.$4"
      ClearErrors
      Rename "$INSTDIR" "$3"
      ${If} ${Errors}
        ; A failed rename is a sharing violation, not a running app. Report the
        ; actual cause instead of electron-builder's blanket "cannot be closed".
        !insertmacro CountInstallDirProcesses $R0
        ${If} $R0 > 0
          DetailPrint "[Installer] Detach blocked by $R0 running app processes"
          !insertmacro StopAppProcesses
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_APP_UNCLOSABLE)" /SD IDCANCEL IDRETRY OldInstallDetachRetry_${TOKEN}
        ${Else}
          DetailPrint "[Installer] Detach blocked: install directory is in use by another program"
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_DIR_OCCUPIED)" /SD IDCANCEL IDRETRY OldInstallDetachRetry_${TOKEN}
        ${EndIf}
        StrCpy $3 "result=detach-aborted processes=$R0"
        !insertmacro OpenTimingLogForAppend $8
        FileWrite $8 "phase=old-install-detach-aborted $3$\r$\n"
        FileClose $8
        ; Matches electron-builder's own cancel handling in CHECK_APP_RUNNING.
        ; Abort would only cancel the page leave in interactive installs.
        Quit
      ${EndIf}
      FileOpen $8 "$APPDATA\ZhiYuanAgent\old-install-path.txt" w
      ; Keep Unicode directory names exact on every Windows system codepage.
      FileWriteUTF16LE /BOM $8 "$3"
      FileClose $8
      StrCpy $3 "result=detached path=$3"
    ${Else}
      StrCpy $3 "result=no-previous-install"
    ${EndIf}
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=old-install-detached elapsed_ms=$5 $3$\r$\n"
    FileClose $8
    ; The old installation is detached or absent at this point; drop its
    ; registration so electron-builder skips the redundant legacy uninstaller
    ; whose exit code 2 would surface as a bogus "cannot be closed" dialog.
    !insertmacro ForgetOldInstallRegistry ${TOKEN}
  ${EndIf}
!macroend
!endif

!ifdef PROJECT_DIR
  !include "${PROJECT_DIR}\scripts\installer-ui\zy-theme.nsh"
  !include "${PROJECT_DIR}\scripts\installer-ui\zy-pages.nsh"
!else
  !include "installer-ui\zy-theme.nsh"
  !include "installer-ui\zy-pages.nsh"
!endif

!insertmacro ZY_LangString ZY_INSTALL_ROOT_INVALID \
  "所选目录不安全或不属于知远。操作已停止，未更改该目录。" \
  "所選目錄不安全或不屬於知遠。操作已停止，未變更該目錄。" \
  "This directory is unsafe or does not belong to ZhiYuan. The operation stopped without changing it."
!insertmacro ZY_LangString ZY_PROCESS_STOP_FAILED \
  "无法安全关闭应用进程。请退出知远后重试。" \
  "無法安全關閉應用程式。請結束知遠後重試。" \
  "Application processes could not be stopped safely. Exit ZhiYuan and try again."
!ifndef BUILD_UNINSTALLER
!insertmacro ZY_LangString ZY_SKILL_MIGRATION_FAILED \
  "未能保留用户创建的 Skills。安装已停止，原安装目录保持不变。请检查访问权限后重新运行安装器。" \
  "無法保留使用者建立的 Skills。安裝已停止，原安裝目錄保持不變。請檢查存取權限後重新執行安裝程式。" \
  "User-created Skills could not be preserved. Setup stopped without changing the existing installation directory. Check access permissions and run setup again."
!endif

; electron-builder defines this from allowToChangeInstallationDirectory; the
; native directory page is replaced by the install-location row on the custom
; hero page, so the define is withdrawn before the assisted template runs.
!undef allowToChangeInstallationDirectory

; MUI consumes MUI_PAGE_CUSTOMFUNCTION_* defines at each MUI page insertion
; and undefs them afterwards, so the SHOW hook has to be (re-)defined at
; every insertion point. Uninstaller pass only: MUI_UNPAGE_INSTFILES consumes
; this one (it brands the native uninstaller instfiles page) before
; customUninstallPage re-defines the hook for MUI_UNPAGE_FINISH. In the
; installer pass nothing consumes a define this early — the install-mode page
; is a raw PageEx custom and the native directory page is disabled above — so
; an early define would collide with customPageAfterChangeDir's re-definition
; (NSIS errors on !define of an existing symbol) and must not be set here.
!ifdef BUILD_UNINSTALLER
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
!endif

; The native uninstaller finish page is the only remaining MUI welcome/finish
; surface; give it the branded side art instead of the stock wizard bitmap.
; electron-builder passes its default wizard bitmap for this key via -D, so
; withdraw it before defining our own (NSIS errors on redefinition).
!ifdef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!endif
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_DIR}\build\installer-assets\zy-side.bmp"

!define ELEVATED_ACTION_SCRIPT "nsis-elevated-actions.ps1"
!define ELEVATED_ACTION_RESULT "elevated-action-result.txt"





; Safety net for any path where electron-builder still runs the previous
; uninstaller (e.g. it lives in a different install directory). The stock
; handler quits the whole installation on a non-zero exit code after showing
; the "cannot be closed" dialog — even when the failure is a locked file,
; not a running process. Files the old uninstaller could not remove are
; overwritten in place by the extraction that follows, so a failed legacy
; uninstall must never abort the install.
!macro customUnInstallCheck
  IfErrors 0 +3
    DetailPrint "[Installer] Previous uninstaller could not be launched; continuing with in-place upgrade"
    Return
  ${if} $R0 != 0
    DetailPrint "[Installer] Previous uninstaller exited with code $R0; continuing with in-place upgrade"
    !insertmacro OpenTimingLogForAppend $8
    FileWrite $8 "phase=previous-uninstall-ignored exit=$R0$\r$\n"
    FileClose $8
  ${endIf}
  Return
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

; electron-builder compiles the uninstaller before the installer. Its assisted
; template does not insert installation pages while BUILD_UNINSTALLER is set,
; so keep the page state and callbacks out of that compilation pass.
; ($installLocalInference/$preparedInstallRoot are declared above the UI
; includes, where ZYHeroLeave and the PrepareExistingInstallForExtraction
; insertion can see them.)
!ifndef BUILD_UNINSTALLER


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
  ; Long spans of this installer run inside nsExec helpers (process stop,
  ; component validation and expansion). Hiding the details view leaves the
  ; progress page motionless for minutes, which users read as a hang.
  ShowInstDetails show
  ; NSIS startup CRC check reads the entire installer before the UI appears.
  ; Payload integrity is covered by per-entry 7z CRCs during extraction plus
  ; sentinel SHA-256 verification, so the extra full-file scan is redundant.
  CRCCheck off
  ; Detach-failure messages. electron-builder only knows "cannot be closed",
  ; which blames a running app even when the blocker is a directory handle
  ; held by another program (typically an Explorer window); keep the two
  ; causes in separate, translated strings. LCIDs are numeric because the
  ; LANG_* constants are not defined at this point in the generated script.
  ; The build loads every bundled NSIS language, and makensis promotes an
  ; unset-per-language LangString (warning 6040) to an error, so every
  ; bundled language gets an entry; untranslated ones fall back to English.
  LangString ZY_APP_UNCLOSABLE 2052 "检测到知远进程仍在运行，且无法自动关闭。$\r$\n$\r$\n可能是以管理员身份运行的。请手动退出知远（右键点击任务栏托盘图标并选择退出），然后点击“重试”。"
  LangString ZY_APP_UNCLOSABLE 1028 "偵測到知遠處理程序仍在執行，且無法自動關閉。$\r$\n$\r$\n可能是以系統管理員身分執行的。請手動結束知遠（在工作列通知區域圖示上按一下右鍵並選擇結束），然後按一下「重試」。"
  LangString ZY_APP_UNCLOSABLE 1033 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1031 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1036 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 3082 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1041 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1042 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1040 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1043 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1030 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1053 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1044 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1035 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1049 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 2070 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1046 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1045 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1058 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1029 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1051 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1038 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1025 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1055 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1054 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_APP_UNCLOSABLE 1066 "ZhiYuan is still running and could not be closed automatically.$\r$\n$\r$\nIt may have been started with administrator rights. Exit ZhiYuan manually (right-click its system tray icon and choose Exit), then click Retry."
  LangString ZY_DIR_OCCUPIED 2052 "无法更新安装目录，目录正被其他程序占用。$\r$\n$\r$\n未检测到正在运行的知远进程。最常见的原因是文件资源管理器正在浏览该目录：$\r$\n$INSTDIR$\r$\n$\r$\n请关闭占用该目录的窗口或程序，然后点击“重试”。"
  LangString ZY_DIR_OCCUPIED 1028 "無法更新安裝目錄，目錄正被其他程式佔用。$\r$\n$\r$\n未偵測到正在執行的知遠處理程序。最常見的原因是檔案總管正在瀏覽該目錄：$\r$\n$INSTDIR$\r$\n$\r$\n請關閉佔用該目錄的視窗或程式，然後按一下「重試」。"
  LangString ZY_DIR_OCCUPIED 1033 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1031 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1036 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 3082 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1041 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1042 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1040 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1043 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1030 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1053 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1044 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1035 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1049 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 2070 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1046 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1045 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1058 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1029 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1051 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1038 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1025 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1055 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1054 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
  LangString ZY_DIR_OCCUPIED 1066 "The installation directory cannot be updated because it is in use by another program.$\r$\n$\r$\nNo running ZhiYuan process was detected. The most common cause is a File Explorer window browsing this directory:$\r$\n$INSTDIR$\r$\n$\r$\nClose the window or program using this directory, then click Retry."
!macroend

; Welcome, install options and license agreement live on a single custom
; hero page (ZYHeroCreate/Leave in installer-ui/zy-pages.nsh), replacing the
; stock MUI welcome page, the native directory page and the old local
; inference options page.
!macro customWelcomePage
  Page custom ZYHeroCreate ZYHeroLeave
!macroend

; The finish page is the only page whose callbacks touch the StdUtils plugin
; (${isUpdated} / ${StdUtils.ExecShellAsUser} in ZYFinishLeave). Its definition
; must therefore be emitted here, in the installer body, rather than from the
; header-time !include of zy-pages.nsh: electron-builder registers the plugin
; directory from a task concurrent with that include, so the header may not
; have declared it yet (makensis then fails with "Plugin not found, cannot call
; StdUtils::TestParameter"). This mirrors the StartApp function electron-builder
; itself defines at this exact insertion point.
!macro customFinishPage
  !insertmacro ZY_DefineFinishLeave
  Page custom ZYFinishCreate ZYFinishLeave
!macroend

; The old options page used to sit here and ran
; PrepareExistingInstallForExtraction from its leave callback; that duty moved
; to ZYHeroLeave. The hook itself is kept as the only template insertion
; point between PAGE_INSTALL_MODE and MUI_PAGE_INSTFILES, which is where the
; instfiles page callbacks must be defined: MUI undefines
; MUI_PAGE_CUSTOMFUNCTION_* right after consuming them.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave
!macroend
!endif

; The application and its runtime cache are per-user, so the install-mode
; page is skipped unless a per-machine installation actually exists (its
; upgrade/uninstall path needs the all-users flow and elevation). multiUserUi
; consults this macro in both the installer and the uninstaller build, so it
; lives outside the !ifndef BUILD_UNINSTALLER block above.
!macro customInstallMode
  ${if} $hasPerMachineInstallation != "1"
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend

; Injection point between MUI_UNPAGE_INSTFILES and MUI_UNPAGE_FINISH: the
; uninstaller's native finish page gets the branded background via the SHOW
; hook (consumed there and undefined by MUI).
!macro customUninstallPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
!macroend

; Branded uninstaller confirmation in place of the stock MUI welcome page.
!macro customUnWelcomePage
  ; Uninstaller page callbacks must be un.-prefixed in the uninstaller build.
  UninstPage custom ${ZY_UNPREFIX}ZYUnWelcomeCreate ${ZY_UNPREFIX}ZYUnWelcomeLeave
!macroend

; NSIS/MUI does not implement /LANGUAGE=. Keep the system/MUI choice when
; absent, and resolve an explicit supported UI language before any page or
; installation work. Unsupported requests must not silently become English.
!macro ApplyRequestedInstallerLanguage
  Push $0
  Push $1
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/LANGUAGE=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "2052"
    ${OrIf} $1 == "1028"
    ${OrIf} $1 == "1033"
      StrCpy $LANGUAGE $1
    ${Else}
      SetErrorLevel 87
      Quit
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $1
  Pop $0
!macroend

!macro customInit
  !insertmacro ApplyRequestedInstallerLanguage
  !insertmacro StageInstallSafetyScripts
  SetDetailsPrint textonly
  CreateDirectory "$APPDATA\ZhiYuanAgent"
  ; Stage the branded UI bitmaps (and license text) the wizard pages load.
  ; File extraction only: this macro also runs for silent installs, where no
  ; page callback ever fires, so no GUI calls are allowed here.
  !insertmacro ZY_StageUiAssets
  File /oname=migrate-user-skills.ps1 "${PROJECT_DIR}\scripts\installer\migrate-user-skills.ps1"
  System::Call 'kernel32::GetTickCount()i .r9'
  FileOpen $8 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" w
  FileWrite $8 "$9"
  FileClose $8
  ; The timing log appends across runs (bounded by the run-start markers) so
  ; repeated install attempts on a user machine stay diagnosable.
  StrCpy $5 "interactive"
  ${If} ${Silent}
    StrCpy $5 "silent"
  ${EndIf}
  !insertmacro OpenTimingLogForAppend $8
  FileWrite $8 "phase=run-start tick_ms=$9 mode=$5 instdir=$INSTDIR$\r$\n"
  FileClose $8

  ; Silent installs never show pages, so no leave callback will fire; prepare
  ; for extraction right here. Interactive installs defer the same steps to
  ; the options-page leave, after the user has committed to installing.
  ${If} ${Silent}
    !insertmacro PrepareExistingInstallForExtraction SILENT
  ${EndIf}
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
  ; Marks the end of the application file extraction span (customInit up to
  ; here is otherwise uninstrumented, which hid the slowest phase on user
  ; machines behind a motionless progress page).
  FileOpen $2 "$APPDATA\ZhiYuanAgent\install-start-tick.txt" r
  IfErrors CustomInstallStartMarked
  FileRead $2 $R5
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $R6 $6 - $R5
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=custom-install-start app_files_ms=$R6$\r$\n"
  FileClose $2
  CustomInstallStartMarked:
  ; First custom progress phase: the 7za hash check and the cache validation
  ; below run inside this span.
  !insertmacro ZY_ProgressPhase VALIDATING "$(ZY_PHASE_VALIDATING)"
  SetOutPath "$PLUGINSDIR"
  !insertmacro ExtractElevatedActionScript
  File /oname=7za.exe "${PROJECT_DIR}\node_modules\7zip-bin\win\x64\7za.exe"
  File /oname=7za.sha256 "${PROJECT_DIR}\build-tar\windows-components\7za.sha256"
  File /oname=component-manifest.json "${PROJECT_DIR}\build-tar\windows-components\manifest.json"
  File /oname=recover-component-switch.ps1 "${PROJECT_DIR}\scripts\installer\recover-component-switch.ps1"
  File /oname=validate-offline-components.ps1 "${PROJECT_DIR}\scripts\installer\validate-offline-components.ps1"
  ; The component switch/link/cleanup logic is shared with the WebView2 setup
  ; shell: single sources of truth under scripts\installer, staged here and
  ; invoked with -File below.
  File /oname=activate-components.ps1 "${PROJECT_DIR}\scripts\installer\activate-components.ps1"
  File /oname=link-runtime-junctions.ps1 "${PROJECT_DIR}\scripts\installer\link-runtime-junctions.ps1"
  File /oname=cleanup-after-install.ps1 "${PROJECT_DIR}\scripts\installer\cleanup-after-install.ps1"
  File /oname=uninstall-cleanup.ps1 "${PROJECT_DIR}\scripts\installer\uninstall-cleanup.ps1"
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

  ; Stage the per-component metadata before deciding which archives to queue.
  !insertmacro ZY_ProgressPhase STAGING "$(ZY_PHASE_STAGING)"
  !insertmacro StageOfflineComponentMetadata "channel-runtime"
  !insertmacro StageOfflineComponentMetadata "skills"
  !insertmacro StageOfflineComponentMetadata "mcps"
  !insertmacro StageOfflineComponentMetadata "portable-git"
  !insertmacro StageOfflineComponentMetadata "python"
  !insertmacro StageOfflineComponentMetadata "skill-python"
  !insertmacro StageOfflineComponentMetadata "uv"

  ; Verify all reusable cache entries in one PowerShell process before deciding
  ; which archives NSIS needs to unpack from the installer.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode cache -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe" -TimingLogPath "$APPDATA\ZhiYuanAgent\install-timing.log"'
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

  ; The changed archives are now present in $PLUGINSDIR. Validate their entries
  ; and sentinels, then extract them in one PowerShell batch. This keeps cache
  ; hits fast while eliminating a PowerShell startup per component; the
  ; per-component phases land in the timing log via -TimingLogPath.
  DetailPrint "[Installer] Validating and expanding offline components"
  !insertmacro ZY_ProgressPhase EXPANDING "$(ZY_PHASE_EXPANDING)"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-offline-components.ps1" -Mode expand -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ComponentTargetsPath "$PLUGINSDIR\component-targets.json" -SevenZipPath "$PLUGINSDIR\7za.exe" -TimingLogPath "$APPDATA\ZhiYuanAgent\install-timing.log"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentBatchExpanded
  StrCmp $0 "3" ComponentBatchArchiveUnsafe
  StrCmp $0 "4" ComponentBatchExtractFailed
  StrCmp $0 "5" ComponentBatchVerificationFailed
    StrCpy $R9 "离线组件批处理失败：$1"
    Goto OfflineComponentInstallFailed

  ComponentBatchArchiveUnsafe:
    StrCpy $R9 "离线组件归档包含不安全路径或链接元数据。"
    Goto OfflineComponentInstallFailed
  ComponentBatchExtractFailed:
    ; Keep the failing component key and the 7za exit code or exception detail
    ; from the validator in the dialog and the install timing log. The validator
    ; already folds newlines, so $1 is a single line.
    StrCpy $R9 "离线组件展开失败：$1。请检查磁盘空间或安全软件后重试。"
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
  !insertmacro ZY_ProgressPhase ACTIVATING "$(ZY_PHASE_ACTIVATING)"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\activate-components.ps1" -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json" -TargetsPath "$PLUGINSDIR\component-targets.json" -StatePath "$LOCALAPPDATA\ZhiYuanAgent\runtimes\component-switch-state.txt"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ComponentPointersReady
    StrCpy $R9 "离线组件切换失败：$1"
    Goto OfflineComponentInstallFailed
  ComponentPointersReady:

  DetailPrint "[Installer] Connecting bundled runtimes"
  !insertmacro ZY_ProgressPhase CONNECTING "$(ZY_PHASE_CONNECTING)"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\link-runtime-junctions.ps1" -ResourceRoot "$INSTDIR\resources" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json"'
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
  !insertmacro ZY_ProgressPhase VERIFYING "$(ZY_PHASE_VERIFYING)"
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
  !insertmacro ZY_ProgressPhase VC "$(ZY_PHASE_VC)"
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
    StrCmp $0 "1223" VcRuntimeReady
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
  !insertmacro ZY_ProgressPhase CLEANUP "$(ZY_PHASE_CLEANUP)"
  ; Remove known junctions explicitly before recursive deletion. This prevents
  ; an old installation cleanup from ever walking into an immutable shared pack.
  DetailPrint "[Installer] Cleaning unused offline component versions"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-after-install.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes" -ManifestPath "$PLUGINSDIR\component-manifest.json" -OldInstallPathFile "$APPDATA\ZhiYuanAgent\old-install-path.txt"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  !insertmacro OpenTimingLogForAppend $2
  FileWrite $2 "phase=component-cleanup-complete elapsed_ms=$5 exit=$0$\r$\n"
  FileClose $2
  Delete "$LOCALAPPDATA\ZhiYuanAgent\runtimes\component-switch-state.txt"

  !insertmacro ZY_ProgressPhase FINALIZING "$(ZY_PHASE_FINALIZING)"
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
  ; Final phase: fills the bar to 100% and swaps in the complete artwork.
  !insertmacro ZY_ProgressPhase DONE "$(ZY_PHASE_DONE)"
!macroend

; Counts processes whose image path starts with $INSTDIR (the count is the
; PowerShell exit code, so no stdout parsing is needed). After a failed
; detach this distinguishes "app still running" from "directory held by
; another program" — electron-builder reports both as "cannot be closed".
!macro customUnInit
  !insertmacro StageInstallSafetyScripts
  !insertmacro ValidateInstallRoot uninstall
  ; The uninstaller confirmation page uses the same branded background art.
  !insertmacro ZY_StageUiAssets
  ; This is a fresh uninstaller process with a fresh $PLUGINSDIR: the shared
  ; cleanup script is only extracted during the installer's customInstall,
  ; which this compilation pass never runs, so stage it here — without it
  ; component junctions and the runtime cache would be left behind.
  SetOutPath "$PLUGINSDIR"
  File /oname=uninstall-cleanup.ps1 "${PROJECT_DIR}\scripts\installer\uninstall-cleanup.ps1"
!macroend

!macro customUnInstall
  ; Revalidate after the confirmation page, immediately before cleanup.
  !insertmacro ValidateInstallRoot uninstall
  !insertmacro StopAppProcesses
  ; Remove component junctions and detach application-owned immutable data.
  ; User-created Skills and models remain under userData. Deleting the
  ; expanded runtime tree synchronously can take longer than the uninstaller
  ; itself, so the shared script renames it atomically and reclaims it in the
  ; background. Keep both the uninstaller and spawned cleanup commands outside
  ; $INSTDIR so electron-builder's final RMDir can remove the now-empty
  ; application root. The component junction/link/detach logic is shared with
  ; the WebView2 setup shell via scripts\installer\uninstall-cleanup.ps1.
  SetOutPath "$TEMP"
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\uninstall-cleanup.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgent\runtimes"'
  Pop $0

  ; electron-builder's DELETE_APP_DATA list only covers $APPDATA\<product
  ; name> variants; the app's real userData directory is %APPDATA%\ZhiYuanAgent
  ; (APP_DATA_DIR_NAME — sessions, memory projection, migrated SKILLs).
  ; Normal uninstallation preserves this tree. Only the explicit destructive
  ; --delete-app-data option may remove it; a packaging default must not opt
  ; the user into losing their conversations, settings, or created Skills.
  StrCpy $zyDeleteRealAppData "0"
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${ifNot} ${Errors}
    StrCpy $zyDeleteRealAppData "1"
  ${endif}
  ${if} $zyDeleteRealAppData == "1"
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    RMDir /r "$APPDATA\ZhiYuanAgent"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}

!macroend
