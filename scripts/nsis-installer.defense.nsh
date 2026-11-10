!include "LogicLib.nsh"

!macro customInit
  ; Reject an explicit /D path containing a different product.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=validate-install-root.ps1 "${PROJECT_DIR}\scripts\installer\validate-install-root.ps1"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\validate-install-root.ps1" -InstallDir "$INSTDIR" -ExecutableName "${PRODUCT_FILENAME}.exe" -RuntimeRoot "$LOCALAPPDATA\ZhiYuanAgentDefense\runtimes" -AppDataRoot "$APPDATA\ZhiYuanAgentDefense"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$1"
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

!macro customInstall
  ; The per-machine installer already runs with administrator rights.
  ; Install the bundled prerequisite before the user launches the application.
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != 1
    StrCpy $0 1
    ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0
    ${If} $0 != 0
    ${AndIf} $0 != 1638
    ${AndIf} $0 != 3010
      SetErrorLevel 1
      Abort "Microsoft Visual C++ Runtime installation failed ($0)."
    ${EndIf}
  ${EndIf}
!macroend
