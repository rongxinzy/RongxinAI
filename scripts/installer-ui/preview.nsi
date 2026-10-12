; preview.nsi — MUI2-faithful preview of the custom installer UI. Mirrors the
; production wizard geometry and page insertion sequence from
; node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh so the
; layouts verified here hold in the real electron-builder build.
;
;   node scripts/installer-ui/build-preview.cjs [--run]
;       [--from=progress|finish|uninstall]
;
; Stubbed surroundings (provided by electron-builder in production):
;   PROJECT_DIR / APP_EXECUTABLE_FILENAME defines, the isUpdated LogicLib
;   condition, StdUtils.ExecShellAsUser, PrepareExistingInstallForExtraction.
;   PAGE_INSTALL_MODE is not compiled here (it needs UAC.dll, which ships
;   with electron-builder's NSIS, not the local preview makensis); the
;   production build skips it at runtime anyway unless a per-machine
;   installation exists.

!define /ifndef ZY_PREVIEW
; The preview hosts custom pages only in some --from variants; without an
; instfiles page NSIS warns that no section will execute (intended there).
!pragma warning disable 8000

!ifdef ZY_PREVIEW_UNINSTALLER
  OutFile "zy-ui-preview-unwriter.exe"
!else
  OutFile "zy-ui-preview.exe"
!endif
Name "ZhiYuan Agent Installer UI Preview"
RequestExecutionLevel user
ManifestDPIAware true
ShowInstDetails show
BrandingText " "

; --- electron-builder stand-ins -------------------------------------------------
!define APP_EXECUTABLE_FILENAME "ZhiYuanAgent.exe"

; Declared by scripts/nsis-installer.nsh in the production build; the hero
; leave callback stores the checkbox state here (installer pass only).
!ifndef BUILD_UNINSTALLER
Var /GLOBAL installLocalInference
!endif

; electron-builder generates this LogicLib condition from the "updated"
; command-line flag via StdUtils.TestParameter; the preview never updates.
!macro _isUpdated _a _b _t _f
  StrCmp "" "" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`

; StdUtils ships with electron-builder's NSIS distribution, not with the
; local preview makensis; log the intent instead of launching.
!macro ZY_PreviewExecShellAsUser OUT PATH OP ARGS
  DetailPrint "preview launch: ${PATH} ${ARGS}"
!macroend
!define StdUtils.ExecShellAsUser `!insertmacro ZY_PreviewExecShellAsUser`

; --- MUI2 + real theme/pages ----------------------------------------------------
!define MUI_DISABLE_INSERT_LANGUAGE_AFTER_PAGES_WARNING ; finish variant hosts custom pages only
!include "MUI2.nsh"

; The native uninstaller finish page carries the branded side art, exactly
; like scripts/nsis-installer.nsh does for the production build.
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${PROJECT_DIR}\build\installer-assets\zy-side.bmp"

!include "zy-theme.nsh"
!include "zy-pages.nsh"

Function .onInit
  InitPluginsDir
  StrCpy $INSTDIR "$PROGRAMFILES64\ZhiYuan Agent"
  SetOutPath "$INSTDIR"
  !insertmacro ZY_StageUiAssets
!ifdef ZY_PREVIEW_UNINSTALLER
  ; The written uninstaller cannot carry File data from page functions, so
  ; leave the staged assets where its pages can copy them back at runtime.
  CreateDirectory "$TEMP\zy-preview-assets"
  CopyFiles "$PLUGINSDIR\*.*" "$TEMP\zy-preview-assets"
  WriteUninstaller "$EXEDIR\zy-ui-preview-un.exe"
  ; Launch the real uninstaller and stay alive until it exits
  ; (WaitForSingleObject semantics on its lifetime mutex) so external
  ; harnesses screenshotting by process tree capture this wizard instead of
  ; a finished page or a long-gone writer.
  ExecShell "open" "$EXEDIR\zy-ui-preview-un.exe" "" SW_SHOW
  StrCpy $R0 0
  zy_mtx_retry:
    System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\zy-preview-uninstall-mutex") i .R1'
    StrCmp $R1 0 zy_mtx_sleep zy_mtx_wait
  zy_mtx_sleep:
    Sleep 200
    IntOp $R0 $R0 + 1
    IntCmp $R0 150 zy_mtx_done zy_mtx_retry zy_mtx_retry
  zy_mtx_wait:
    System::Call 'kernel32::WaitForSingleObject(i R1, i -1) i .R2'
    System::Call 'kernel32::CloseHandle(i R1)'
  zy_mtx_done:
  Quit
!else
  ; Reference every page function so the compiler's unreferenced-function
  ; zeroing (which shifts Call targets of later functions) never kicks in for
  ; --from variants that skip pages. This branch never executes.
  ${If} 1 == 2
    Call ZYHeroCreate
    Call ZYHeroLeave
    Call ZYFinishCreate
    Call ZYFinishLeave
    Call ZYUnWelcomeCreate
    Call ZYUnWelcomeLeave
    Call ZY_MuiPageShow
    Call ZY_MuiPageLeave
  ${EndIf}
!endif
FunctionEnd

; Page sequence mirrors assistedInstaller.nsh: custom welcome (hero) ->
; [PAGE_INSTALL_MODE, production only] -> instfiles -> custom finish. The
; SHOW/LEAVE defines precede MUI_PAGE_INSTFILES exactly where
; customPageAfterChangeDir injects them in production, because MUI undefines
; MUI_PAGE_CUSTOMFUNCTION_* after each page insertion.
!ifdef ZY_PREVIEW_UNINSTALLER
  UninstPage custom ${ZY_UNPREFIX}ZYUnWelcomeCreate ${ZY_UNPREFIX}ZYUnWelcomeLeave
  !insertmacro MUI_UNPAGE_INSTFILES
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
  !insertmacro MUI_UNPAGE_FINISH

  Section "un.preview"
    Sleep 1500
  SectionEnd

  ; NSIS requires at least one installer section; the writer quits in
  ; .onInit before any section runs.
  Section "writer"
  SectionEnd
!else
  !if "${ZY_PREVIEW_FROM}" == "progress"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave
    !insertmacro MUI_PAGE_INSTFILES
    Page custom ZYFinishCreate ZYFinishLeave
  !else
    !if "${ZY_PREVIEW_FROM}" == "finish"
      Page custom ZYFinishCreate ZYFinishLeave
    !else
      Page custom ZYHeroCreate ZYHeroLeave
      !define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow
      !define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave
      !insertmacro MUI_PAGE_INSTFILES
      Page custom ZYFinishCreate ZYFinishLeave
    !endif
  !endif

  Section
    ; Simulate the customInstall phase boundaries on the instfiles page.
    Sleep 500
    !insertmacro ZY_ProgressPhase VALIDATING "$(ZY_PHASE_VALIDATING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase STAGING "$(ZY_PHASE_STAGING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase EXPANDING "$(ZY_PHASE_EXPANDING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase ACTIVATING "$(ZY_PHASE_ACTIVATING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase CONNECTING "$(ZY_PHASE_CONNECTING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase VERIFYING "$(ZY_PHASE_VERIFYING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase VC "$(ZY_PHASE_VC)"
    Sleep 500
    !insertmacro ZY_ProgressPhase CLEANUP "$(ZY_PHASE_CLEANUP)"
    Sleep 500
    !insertmacro ZY_ProgressPhase FINALIZING "$(ZY_PHASE_FINALIZING)"
    Sleep 500
    !insertmacro ZY_ProgressPhase DONE "$(ZY_PHASE_DONE)"
  SectionEnd
!endif

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
