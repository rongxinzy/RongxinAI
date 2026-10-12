; zy-pages.nsh — page functions and string table for the fully custom
; ZhiYuan Agent installer UI. Included by scripts/nsis-installer.nsh, which
; owns the template hook macros (customWelcomePage, customFinishPage, ...).
;
; Page inventory:
;   ZYHeroCreate/Leave        welcome + install options + license (one page)
;   ZYProgressShow            branded progress surface for MUI_PAGE_INSTFILES
;   ZY_MuiPageShow/Leave      MUI SHOW/LEAVE hook (install-mode page chrome,
;                             instfiles progress wiring)
;   ZYFinishCreate/Leave      completion page with launch option
;   ZYUnWelcomeCreate/Leave   uninstaller confirmation
;
; UI code lives exclusively in page callbacks; /S never executes them. The
; only non-page additions are File extractions in customInit/customUnInit.

; ---------------------------------------------------------------------------
; Uninstaller builds require un.-prefixed functions; the prefix macro keeps a
; single definition per page function.
; ---------------------------------------------------------------------------
!ifdef BUILD_UNINSTALLER
  !define ZY_UNPREFIX un.
!else
  !define ZY_UNPREFIX ``
!endif

; ---------------------------------------------------------------------------
; Globals
; ---------------------------------------------------------------------------
Var /GLOBAL zyLicenseAvailable   ; staged license.txt present
Var /GLOBAL zyBgBitmap           ; background bitmap control handle
Var /GLOBAL zyBgImage            ; loaded background bitmap handle
Var /GLOBAL zyFont               ; latest CreateFont handle
Var /GLOBAL zyDialog             ; current nsDialogs dialog handle
!ifndef BUILD_UNINSTALLER
Var /GLOBAL zyLaunchApp          ; finish page: launch the app on leave
Var /GLOBAL heroDirText          ; read-only $INSTDIR display
Var /GLOBAL heroInference        ; local inference checkbox
Var /GLOBAL heroLicense          ; license agreement checkbox
Var /GLOBAL heroInstall          ; primary Install button
Var /GLOBAL heroCancelNative     ; hidden native Cancel, driven via BM_CLICK
; Progress page controls (raw Win32 children of the native inner dialog).
; Uninstaller builds never create them, but the globals stay declared because
; ZY_MuiPageShow compiles in both passes.
Var /GLOBAL zyPhaseLabel         ; phase text static
Var /GLOBAL zyFill               ; brand fill bar static
Var /GLOBAL zyMask               ; track-colored mask sliding over the fill
Var /GLOBAL zyComplete           ; 100% bar (both ends rounded)
Var /GLOBAL zyBarX               ; bar left edge, pixels
Var /GLOBAL zyBarY               ; bar top edge, pixels
Var /GLOBAL zyCurFill            ; current fill width, pixels
Var /GLOBAL zyPhaseCount         ; phases already announced
!endif ; !BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; String table. Every bundled NSIS language needs an entry per LangString
; (makensis promotes the unset-per-language warning to an error), so the
; untranslated LCIDs share the English text. LCIDs are numeric because the
; LANG_* constants are not defined at this point. The preview build only
; emits the LCIDs it actually loads (en + zh-CN + zh-TW).
; ---------------------------------------------------------------------------
!macro ZY_LangStringEn NAME VALUE
!ifdef ZY_PREVIEW
  LangString ${NAME} 1033 "${VALUE}"
!else
  LangString ${NAME} 1033 "${VALUE}"
  LangString ${NAME} 1031 "${VALUE}"
  LangString ${NAME} 1036 "${VALUE}"
  LangString ${NAME} 3082 "${VALUE}"
  LangString ${NAME} 1041 "${VALUE}"
  LangString ${NAME} 1042 "${VALUE}"
  LangString ${NAME} 1040 "${VALUE}"
  LangString ${NAME} 1043 "${VALUE}"
  LangString ${NAME} 1030 "${VALUE}"
  LangString ${NAME} 1053 "${VALUE}"
  LangString ${NAME} 1044 "${VALUE}"
  LangString ${NAME} 1035 "${VALUE}"
  LangString ${NAME} 1049 "${VALUE}"
  LangString ${NAME} 2070 "${VALUE}"
  LangString ${NAME} 1046 "${VALUE}"
  LangString ${NAME} 1045 "${VALUE}"
  LangString ${NAME} 1058 "${VALUE}"
  LangString ${NAME} 1029 "${VALUE}"
  LangString ${NAME} 1038 "${VALUE}"
  LangString ${NAME} 1025 "${VALUE}"
  LangString ${NAME} 1055 "${VALUE}"
  LangString ${NAME} 1054 "${VALUE}"
  LangString ${NAME} 1066 "${VALUE}"
  LangString ${NAME} 1051 "${VALUE}"
!endif
!macroend

!macro ZY_LangString NAME ZHCN ZHTW EN
!ifdef ZY_PREVIEW
  ; The preview loads only the zh-CN and English MUI language tables.
  LangString ${NAME} 2052 "${ZHCN}"
  LangString ${NAME} 1033 "${EN}"
!else
  LangString ${NAME} 2052 "${ZHCN}"
  LangString ${NAME} 1028 "${ZHTW}"
  !insertmacro ZY_LangStringEn ${NAME} "${EN}"
!endif
!macroend

!insertmacro ZY_LangString ZY_UI_TITLE \
  "知远智能体 / ZhiYuan Agent" \
  "知遠智能體 / ZhiYuan Agent" \
  "ZhiYuan Agent"
!insertmacro ZY_LangString ZY_UI_TAGLINE \
  "本地优先的全能 AI 智能体，装好离线环境即可使用。" \
  "本地優先的全能 AI 智能體，準備好離線環境即可使用。" \
  "Your local-first AI agent, ready as soon as the offline environment is prepared."
!insertmacro ZY_LangString ZY_UI_INSTALL_LOCATION \
  "安装位置" \
  "安裝位置" \
  "Install location"
!insertmacro ZY_LangString ZY_UI_BROWSE \
  "更改…" \
  "變更…" \
  "Change..."
!insertmacro ZY_LangString ZY_UI_LOCAL_INFERENCE \
  "安装本地推理组件" \
  "安裝本地推理元件" \
  "Install local inference components"
!insertmacro ZY_LangString ZY_UI_LOCAL_INFERENCE_HINT \
  "开启后首次启动时会下载 CPU 或 NVIDIA CUDA 后端（16-621 MB）。" \
  "開啟後首次啟動時會下載 CPU 或 NVIDIA CUDA 後端（16-621 MB）。" \
  "The CPU or NVIDIA CUDA backend (16-621 MB) is downloaded on first launch."
!insertmacro ZY_LangString ZY_UI_LOCAL_INFERENCE_HINT2 \
  "不勾选不会影响其他功能。" \
  "不勾選不會影響其他功能。" \
  "Leaving it unchecked does not affect other features."
!insertmacro ZY_LangString ZY_UI_LICENSE_AGREE \
  "已阅读并同意" \
  "已閱讀並同意" \
  "I have read and agree to the"
!insertmacro ZY_LangString ZY_UI_LICENSE_LINK \
  "《许可协议》" \
  "《授權協議》" \
  "License Agreement"
!insertmacro ZY_LangString ZY_UI_INSTALL \
  "安装" \
  "安裝" \
  "Install"
!insertmacro ZY_LangString ZY_UI_CANCEL \
  "取消" \
  "取消" \
  "Cancel"
!insertmacro ZY_LangString ZY_UI_INSTALLING_TITLE \
  "正在安装知远智能体" \
  "正在安裝知遠智能體" \
  "Installing ZhiYuan Agent"
!insertmacro ZY_LangString ZY_UI_FINISH_TITLE \
  "安装完成" \
  "安裝完成" \
  "Installation complete"
!insertmacro ZY_LangString ZY_UI_FINISH \
  "完成" \
  "完成" \
  "Finish"
!insertmacro ZY_LangString ZY_UI_LAUNCH \
  "启动知远智能体" \
  "啟動知遠智能體" \
  "Launch ZhiYuan Agent"
!insertmacro ZY_LangString ZY_UI_UNINSTALL_TITLE \
  "确定要卸载知远智能体吗？" \
  "確定要解除安裝知遠智能體嗎？" \
  "Are you sure you want to uninstall ZhiYuan Agent?"
!insertmacro ZY_LangString ZY_UI_UNINSTALL_CONFIRM \
  "此操作将删除知远智能体及其本地离线运行环境。" \
  "此操作將刪除知遠智能體及其本機離線執行環境。" \
  "This will remove ZhiYuan Agent and its local offline runtime environment."
!insertmacro ZY_LangString ZY_UI_UNINSTALL_BUTTON \
  "卸载" \
  "解除安裝" \
  "Uninstall"
!insertmacro ZY_LangString ZY_LICENSE_MISSING \
  "安装包中未找到许可协议文本。" \
  "安裝套件中找不到授權協議文字。" \
  "The license agreement text could not be found in this installer."
!insertmacro ZY_LangString ZY_PHASE_VALIDATING \
  "正在校验离线组件…" \
  "正在驗證離線元件…" \
  "Validating offline components..."
!insertmacro ZY_LangString ZY_PHASE_STAGING \
  "正在准备离线组件…" \
  "正在準備離線元件…" \
  "Preparing offline components..."
!insertmacro ZY_LangString ZY_PHASE_EXPANDING \
  "正在展开离线组件…" \
  "正在展開離線元件…" \
  "Expanding offline components..."
!insertmacro ZY_LangString ZY_PHASE_ACTIVATING \
  "正在激活离线组件…" \
  "正在啟用離線元件…" \
  "Activating offline components..."
!insertmacro ZY_LangString ZY_PHASE_CONNECTING \
  "正在连接运行环境…" \
  "正在連線執行環境…" \
  "Connecting runtime environment..."
!insertmacro ZY_LangString ZY_PHASE_VERIFYING \
  "正在校验运行环境…" \
  "正在驗證執行環境…" \
  "Verifying runtime environment..."
!insertmacro ZY_LangString ZY_PHASE_VC \
  "正在安装 Microsoft Visual C++ 运行时…" \
  "正在安裝 Microsoft Visual C++ 執行階段…" \
  "Installing Microsoft Visual C++ Runtime..."
!insertmacro ZY_LangString ZY_PHASE_CLEANUP \
  "正在清理旧版本…" \
  "正在清理舊版本…" \
  "Cleaning up previous version..."
!insertmacro ZY_LangString ZY_PHASE_FINALIZING \
  "正在完成安装…" \
  "正在完成安裝…" \
  "Finalizing installation..."
!insertmacro ZY_LangString ZY_PHASE_DONE \
  "安装完成" \
  "安裝完成" \
  "Installation complete"

; ---------------------------------------------------------------------------
; Shared helpers
; ---------------------------------------------------------------------------

; ZY_ClickWizardNext — drive the wizard forward as if the (hidden) native
; Next button had been clicked. Posted (not sent): this runs inside control
; callbacks/timer dispatches where a synchronous page switch re-enters
; nsDialogs and crashes it.
!macro ZY_ClickWizardNext
  GetDlgItem $0 $HWNDPARENT 1
  System::Call 'user32::PostMessageW(i $HWNDPARENT, i ${WM_COMMAND}, i 1, i $0)'
!macroend

; ---------------------------------------------------------------------------
; Hero page: brand header + tagline + install location + local inference
; option + license agreement + primary Install action. Installer build only:
; the uninstaller pass never declares $installLocalInference.
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
Function ZYHeroCreate
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  SetCtlColors $zyDialog "" "${ZY_COLOR_BG}"

  ; Hide the native Cancel up front; the custom action button below drives
  ; it via BM_CLICK so the wizard keeps its native cancel-confirmation flow.
  GetDlgItem $heroCancelNative $HWNDPARENT 2
  ShowWindow $heroCancelNative ${SW_HIDE}

  ; Content layout (nsDialogs units) targets the 300x152u MUI content area.
  ; The branded background is created LAST: nsDialogs stacks each new control
  ; at the bottom of the z-order, so the art ends up under the content.

  ; Wordmark on the white top band of the background art.
  ${NSD_CreateBitmap} ${ZY_HERO_WORDMARK_X} ${ZY_HERO_WORDMARK_Y} ${ZY_HERO_WORDMARK_W} ${ZY_HERO_WORDMARK_H} ""
  Pop $0
  ${NSD_SetStretchedImage} $0 "${ZY_ASSET_WORDMARK}" $1

  ${NSD_CreateLabel} ${ZY_ROW_X} ${ZY_HERO_TITLE_Y} 260u ${ZY_HERO_TITLE_H} "$(ZY_UI_TITLE)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_TITLE_SIZE} ${ZY_FONT_TITLE_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_TEXT}

  ${NSD_CreateLabel} ${ZY_ROW_X} ${ZY_HERO_TAGLINE_Y} 265u ${ZY_HERO_TAGLINE_H} "$(ZY_UI_TAGLINE)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_MUTED}

  
  ${NSD_CreateText} ${ZY_ROW_X} ${ZY_HERO_PATH_Y} ${ZY_HERO_PATH_W} ${ZY_HERO_PATH_H} "$INSTDIR"
  Pop $heroDirText
  SendMessage $heroDirText ${EM_SETREADONLY} 1 0
  !insertmacro ZY_SetFont $heroDirText ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  !insertmacro ZY_LabelStyle $heroDirText ${ZY_COLOR_TEXT}

  ${NSD_CreateButton} ${ZY_HERO_BROWSE_X} ${ZY_HERO_BROWSE_Y} ${ZY_HERO_BROWSE_W} ${ZY_HERO_BROWSE_H} "$(ZY_UI_BROWSE)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BUTTON_WT}
  ${NSD_OnClick} $0 ZYHeroBrowse

  ${NSD_CreateCheckbox} ${ZY_ROW_X} ${ZY_HERO_INFER_Y} ${ZY_HERO_INFER_W} ${ZY_HERO_INFER_H} "$(ZY_UI_LOCAL_INFERENCE)"
  Pop $heroInference
  ${NSD_SetState} $heroInference ${BST_UNCHECKED}
  !insertmacro ZY_SetFont $heroInference ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  !insertmacro ZY_LabelStyle $heroInference ${ZY_COLOR_TEXT}

  ${NSD_CreateLabel} ${ZY_HERO_HINT_X} ${ZY_HERO_HINT_Y} ${ZY_HERO_HINT_W} ${ZY_HERO_HINT_H} "$(ZY_UI_LOCAL_INFERENCE_HINT)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_HINT_SIZE} ${ZY_FONT_HINT_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_MUTED}

  ${NSD_CreateLabel} ${ZY_HERO_HINT_X} ${ZY_HERO_HINT2_Y} ${ZY_HERO_HINT_W} ${ZY_HERO_HINT2_H} "$(ZY_UI_LOCAL_INFERENCE_HINT2)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_HINT_SIZE} ${ZY_FONT_HINT_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_MUTED}

  ${NSD_CreateCheckbox} ${ZY_HERO_LICENSE_X} ${ZY_HERO_LICENSE_Y} ${ZY_HERO_LICENSE_W} ${ZY_HERO_LICENSE_H} "$(ZY_UI_LICENSE_AGREE)"
  Pop $heroLicense
  ${NSD_SetState} $heroLicense ${BST_UNCHECKED}
  !insertmacro ZY_SetFont $heroLicense ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  !insertmacro ZY_LabelStyle $heroLicense ${ZY_COLOR_TEXT}
  ${NSD_OnClick} $heroLicense ZYHeroLicenseClick

  ${NSD_CreateLink} ${ZY_HERO_LINK_X} ${ZY_HERO_LINK_Y} ${ZY_HERO_LINK_W} ${ZY_HERO_LINK_H} "$(ZY_UI_LICENSE_LINK)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  SetCtlColors $0 "${ZY_COLOR_BRAND}" "${ZY_COLOR_BG}"
  ${NSD_OnClick} $0 ZYHeroLinkClick

  ${NSD_CreateButton} ${ZY_HERO_INSTALL_X} ${ZY_HERO_INSTALL_Y} ${ZY_HERO_INSTALL_W} ${ZY_HERO_INSTALL_H} "$(ZY_UI_INSTALL)"
  Pop $heroInstall
  !insertmacro ZY_SetFont $heroInstall ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BUTTON_WT}
  EnableWindow $heroInstall 0
  ${NSD_OnClick} $heroInstall ZYInstallClick

  ; Custom Cancel inside the content area, 8u left of the primary action and
  ; on its baseline; it drives the hidden native Cancel via BM_CLICK.
  ${NSD_CreateButton} ${ZY_HERO_CANCEL_X} ${ZY_HERO_INSTALL_Y} ${ZY_HERO_CANCEL_W} ${ZY_HERO_INSTALL_H} "$(ZY_UI_CANCEL)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BUTTON_WT}
  ${NSD_OnClick} $0 ZYHeroCancelClick

  !insertmacro ZY_HideMuiChrome
  !insertmacro ZY_HideWizardButtons

  !insertmacro ZY_BgInit

  nsDialogs::Show
FunctionEnd

Function ZYHeroCancelClick
  SendMessage $heroCancelNative ${BM_CLICK} 0 0
FunctionEnd

Function ZYHeroBrowse
  nsDialogs::SelectFolderDialog "$(ZY_UI_INSTALL_LOCATION)" $INSTDIR
  Pop $0
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  SendMessage $heroDirText ${WM_SETTEXT} 0 "STR:$INSTDIR"
FunctionEnd

Function ZYHeroLicenseClick
  ${NSD_GetState} $heroLicense $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $heroInstall 1
  ${Else}
    EnableWindow $heroInstall 0
  ${EndIf}
FunctionEnd

Function ZYHeroLinkClick
  ${If} $zyLicenseAvailable == "1"
    ExecShell "open" "${ZY_ASSET_LICENSE}"
  ${Else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(ZY_LICENSE_MISSING)"
  ${EndIf}
FunctionEnd

Function ZYInstallClick
  ; The disabled button already enforces the license state; double-check.
  ${NSD_GetState} $heroLicense $0
  ${If} $0 != ${BST_CHECKED}
    Return
  ${EndIf}
  !insertmacro ZY_ClickWizardNext
FunctionEnd

Function ZYHeroLeave
  ${NSD_GetState} $heroInference $installLocalInference
  ; Leaving the hero page commits the user to installing, so the destructive
  ; pre-extraction steps run here rather than in .onInit.
!ifndef ZY_PREVIEW
  !insertmacro PrepareExistingInstallForExtraction INTERACTIVE
!endif
FunctionEnd
!endif ; !BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; MUI page hook: brands every MUI page surface and builds the custom progress
; UI on the instfiles page (detected by its native progress bar, ID 1004).
; ---------------------------------------------------------------------------
Function ${ZY_UNPREFIX}ZY_MuiPageShow

  System::Call 'kernel32::GetTickCount()i .R8'

  FindWindow $0 "#32770" "" $HWNDPARENT
  StrCmp $0 0 zy_mui_show_done
  !insertmacro ZY_HideMuiChrome
  ; The native instfiles controls may not exist yet when this hook fires
  ; (raw Page callbacks run earlier than MUI's internal show function), so
  ; poll briefly for the progress bar (ID 1004).
  StrCpy $2 0
  zy_mui_show_poll:
    GetDlgItem $1 $0 1004
    StrCmp $1 0 0 zy_mui_show_detected
    Sleep 100
    IntOp $2 $2 + 1
    IntCmp $2 5 zy_mui_show_detected zy_mui_show_poll zy_mui_show_poll
  zy_mui_show_detected:
  System::Call 'kernel32::GetTickCount()i .R8'

  ${If} $1 != 0
    ; Native instfiles page: replace the chrome with the branded progress.
!ifndef BUILD_UNINSTALLER
    Call ZYProgressShow
!endif
  ${Else}
    ; Custom-controls MUI page (install-mode selection, uninstaller finish):
    ; paint the branded background under the already-created controls.
    ${NSD_CreateBitmap} 0 0 100% 100% ""
    Pop $2
    ${If} $2 != error
      ${NSD_SetStretchedImage} $2 "${ZY_ASSET_BG}" $3
      System::Call 'user32::SetWindowPos(i $2, i 1, i 0, i 0, i 0, i 0, i 0x13)'
    ${EndIf}
  ${EndIf}
  zy_mui_show_done:
FunctionEnd

!ifndef BUILD_UNINSTALLER
Function ZY_MuiPageLeave
  System::Call 'kernel32::GetTickCount()i .R8'

  ; The instfiles dialog (and its controls) is destroyed on page leave;
  ; forget the handles so later phases cannot message stale windows.
  StrCpy $zyPhaseLabel ""
  StrCpy $zyFill ""
  StrCpy $zyMask ""
  StrCpy $zyComplete ""
  StrCpy $zyCurFill 0
  StrCpy $zyPhaseCount 0
FunctionEnd
!endif ; !BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; Branded progress surface for MUI_PAGE_INSTFILES. The controls are raw
; Win32 statics parented to $HWNDPARENT (the wizard window) and positioned
; over the inner dialog, whose rect is mapped into the wizard's client
; coordinates: painting then goes through the wizard's own dialog procedure,
; the same proven path MUI uses for its controls. $0 carries the inner dialog
; handle (found by the caller). nsDialogs::Create cannot be used here because
; the 1018 template already owns the native controls.
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
Function ZYProgressShow

  ; Hide the native controls: header text 1006, progress 1004, details 1016,
  ; show-log button 1027.
  GetDlgItem $1 $0 1006
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $0 1004
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $0 1016
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $0 1027
  ShowWindow $1 ${SW_HIDE}

  ; Inner dialog rect mapped into $HWNDPARENT client coordinates. NB: at
  ; script level $rN and $RN are the SAME variable, so the y-temp below uses
  ; $R8 to avoid aliasing the $R2/$R3 offsets.
  System::Alloc 16
  Pop $R1
  System::Call 'user32::GetWindowRect(i $0, p R1)'
  System::Call 'user32::MapWindowPoints(i 0, i $HWNDPARENT, p R1, i 2)'
  System::Call '*$R1(i .R2, i .R3, i .R4, i .R5)'
  System::Free $R1
  IntOp $4 $R4 - $R2
  IntOp $5 $R5 - $R3

  ; Background art covering the whole inner dialog area.
  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i $R2, i $R3, i $4, i $5, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BG}"

  ; Title and phase text sit in the bitmap's flat zone (the art band occupies
  ; the top 34%): title at 40%, phase line 40px below, bar at 68%.
  IntOp $R8 $5 * ${ZY_PROG_TITLE_Y}
  IntOp $R8 $R8 / 100
  IntOp $R8 $R8 + $R3
  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "$(ZY_UI_INSTALLING_TITLE)", i 0x50000001, i $R2, i $R8, i $4, i 30, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  CreateFont $zyFont "${ZY_FONT_FAMILY}" ${ZY_FONT_TITLE_SIZE} ${ZY_FONT_TITLE_WT}
  SendMessage $R6 ${WM_SETFONT} $zyFont 1
  SetCtlColors $R6 "${ZY_COLOR_TEXT}" "transparent"

  ; Phase text under the title.
  IntOp $R8 $R8 + ${ZY_PROG_PHASE_DY}
  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x50000001, i $R2, i $R8, i $4, i 22, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  CreateFont $zyFont "${ZY_FONT_FAMILY}" ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  SendMessage $R6 ${WM_SETFONT} $zyFont 1
  SetCtlColors $R6 "${ZY_COLOR_MUTED}" "transparent"
  StrCpy $zyPhaseLabel $R6

  ; Bar row at 68% of the surface, centered horizontally.
  IntOp $zyBarY $5 * ${ZY_PROG_BAR_Y}
  IntOp $zyBarY $zyBarY / 100
  IntOp $zyBarY $zyBarY + $R3
  IntOp $zyBarX $4 / 2
  IntOp $zyBarX $zyBarX - 200
  IntOp $zyBarX $zyBarX + $R2

  ; Track, fill, mask, then the complete bar, stacked in creation order.
  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i $zyBarX, i $zyBarY, i ${ZY_BAR_W}, i ${ZY_BAR_H}, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BAR_TRACK}"

  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i $zyBarX, i $zyBarY, i ${ZY_BAR_W}, i ${ZY_BAR_H}, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BAR_FILL}"
  StrCpy $zyFill $R6

  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i $zyBarX, i $zyBarY, i ${ZY_BAR_W}, i ${ZY_BAR_H}, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BAR_TRACK}"
  StrCpy $zyMask $R6

  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i $zyBarX, i $zyBarY, i ${ZY_BAR_W}, i ${ZY_BAR_H}, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BAR_DONE}"
  ShowWindow $R6 ${SW_HIDE}
  StrCpy $zyComplete $R6

  StrCpy $zyCurFill 0
  StrCpy $zyPhaseCount 0
FunctionEnd
!endif ; !BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; Finish page (installer build only; reuses $installLocalInference-era
; defines such as APP_EXECUTABLE_FILENAME from the installer pass).
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
Function ZYFinishCreate
  StrCpy $zyLaunchApp "0"
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  SetCtlColors $zyDialog "" "${ZY_COLOR_BG}"

  ; The success glyph sits in the bitmap's flat zone (the art band occupies
  ; the top 34%) so its opaque base color matches the surrounding pixels.
  ${NSD_CreateBitmap} ${ZY_FINISH_GLYPH_X} ${ZY_FINISH_GLYPH_Y} ${ZY_FINISH_GLYPH_W} ${ZY_FINISH_GLYPH_H} ""
  Pop $0
  ${NSD_SetStretchedImage} $0 "${ZY_ASSET_DONE}" $1

  ; The finish title is a raw centered static on $HWNDPARENT (the same
  ; proven path as the progress labels): SS_CENTER via nsDialogs kept
  ; rendering left-aligned under MUI2, and this also matches the glyph's
  ; axis exactly. Positioned over the content area at the title row.
  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 != 0
    System::Alloc 16
    Pop $R1
    System::Call 'user32::GetWindowRect(i $0, p R1)'
    System::Call 'user32::MapWindowPoints(i 0, i $HWNDPARENT, p R1, i 2)'
    System::Call '*$R1(i .R2, i .R3, i .R4, i .R5)'
    System::Free $R1
    ; Title row: ZY_FINISH_TITLE_Y of the 140u content height; row height
    ; scales with the measured inner dialog.
    IntOp $R6 $R5 - $R3          ; inner height
    IntOp $R8 $R4 - $R2          ; inner width
    IntOp $R7 $R6 * ${ZY_FINISH_TITLE_Y}
    IntOp $R7 $R7 / 140
    IntOp $R7 $R7 + $R3
    IntOp $R6 $R6 * ${ZY_FINISH_TITLE_H}
    IntOp $R6 $R6 / 140          ; row height
    System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "$(ZY_UI_FINISH_TITLE)", i 0x50000001, i $R2, i $R7, i $R8, i $R6, i $HWNDPARENT, i 0, i 0, i 0) i .R9'
    CreateFont $zyFont "${ZY_FONT_FAMILY}" ${ZY_FONT_TITLE_SIZE} ${ZY_FONT_TITLE_WT}
    SendMessage $R9 ${WM_SETFONT} $zyFont 1
    SetCtlColors $R9 "${ZY_COLOR_TEXT}" "transparent"
  ${EndIf}

!ifndef HIDE_RUN_AFTER_FINISH
  ${NSD_CreateButton} ${ZY_FINISH_LAUNCH_X} ${ZY_FINISH_BTN_Y} ${ZY_FINISH_LAUNCH_W} ${ZY_FINISH_BTN_H} "$(ZY_UI_LAUNCH)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BUTTON_WT}
  ${NSD_OnClick} $0 ZYFinishLaunchClick
!endif

  ${NSD_CreateButton} ${ZY_FINISH_FINISH_X} ${ZY_FINISH_BTN_Y} ${ZY_FINISH_FINISH_W} ${ZY_FINISH_BTN_H} "$(ZY_UI_FINISH)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BUTTON_WT}
  ${NSD_OnClick} $0 ZYFinishCloseClick

  !insertmacro ZY_HideMuiChrome
  !insertmacro ZY_HideWizardButtons
  ; Cancel (2) is meaningless once the installation has completed.
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}

  !insertmacro ZY_BgInit

  nsDialogs::Show
FunctionEnd

Function ZYFinishLaunchClick
  StrCpy $zyLaunchApp "1"
  !insertmacro ZY_ClickWizardNext
FunctionEnd

Function ZYFinishCloseClick
  !insertmacro ZY_ClickWizardNext
FunctionEnd

Function ZYFinishLeave
  ${If} $zyLaunchApp == "1"
    ; Mirror electron-builder's StartApp semantics: relaunch through the
    ; non-elevated user token with the --updated flag when upgrading.
    ${if} ${isUpdated}
      StrCpy $0 "--updated"
    ${else}
      StrCpy $0 ""
    ${endif}
!ifdef ZY_PREVIEW
    DetailPrint "preview launch: $INSTDIR\${APP_EXECUTABLE_FILENAME} $0"
!else
  ; APP_EXECUTABLE_FILENAME is only defined later (common.nsh), after this
  ; include has been processed; PRODUCT_FILENAME arrives via -D, so derive
  ; the exe name the same way common.nsh does.
  ${StdUtils.ExecShellAsUser} $1 "$INSTDIR\${PRODUCT_FILENAME}.exe" "open" "$0"
!endif
  ${EndIf}
FunctionEnd
!endif ; !BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; Uninstaller confirmation. These callbacks are referenced from
; customUnWelcomePage, which only the assisted template's uninstaller branch
; inserts, so they are compiled exclusively in the BUILD_UNINSTALLER pass;
; compiling them into the installer pass as well would trip makensis'
; unreferenced-function warning (6010), promoted to an error by
; electron-builder's -WX.
; ---------------------------------------------------------------------------
!ifdef BUILD_UNINSTALLER
Function ${ZY_UNPREFIX}ZYUnWelcomeCreate
!ifdef ZY_PREVIEW
  ; Preview-only staging: File data inside uninstaller page functions is not
  ; embedded into the written uninstaller, so the writer extracts the assets
  ; to $TEMP\zy-preview-assets and the page copies them back at runtime
  ; (production stages via customUnInit and carries its own File data).
  ; The mutex marks this wizard's lifetime for the writer process, which
  ; waits on it so external process-tree screenshot harnesses capture this
  ; page while it is alive.
  System::Call 'kernel32::CreateMutexW(i 0, i 1, w "Local\zy-preview-uninstall-mutex") i .r0'
  InitPluginsDir
  IfFileExists "$TEMP\zy-preview-assets\zy-bg.bmp" 0 +2
    CopyFiles "$TEMP\zy-preview-assets\*.*" "$PLUGINSDIR"
  SetOutPath "$PLUGINSDIR"
!endif
  nsDialogs::Create 1018
  Pop $zyDialog
  ${If} $zyDialog == error
    Abort
  ${EndIf}
  SetCtlColors $zyDialog "" "${ZY_COLOR_BG}"

  ${NSD_CreateLabel} ${ZY_UNWELCOME_TITLE_X} ${ZY_UNWELCOME_TITLE_Y} ${ZY_UNWELCOME_TITLE_W} ${ZY_UNWELCOME_TITLE_H} "$(ZY_UI_UNINSTALL_TITLE)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_TITLE_SIZE} ${ZY_FONT_TITLE_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_TEXT}

  ${NSD_CreateLabel} ${ZY_UNWELCOME_TITLE_X} ${ZY_UNWELCOME_TEXT_Y} ${ZY_UNWELCOME_TEXT_W} ${ZY_UNWELCOME_TEXT_H} "$(ZY_UI_UNINSTALL_CONFIRM)"
  Pop $0
  !insertmacro ZY_SetFont $0 ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}
  !insertmacro ZY_LabelStyle $0 ${ZY_COLOR_MUTED}

  ; Reuse the native wizard buttons: Next (1) becomes Uninstall, Cancel (2)
  ; stays; Back (3) is hidden.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(ZY_UI_UNINSTALL_BUTTON)"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}

  !insertmacro ZY_HideMuiChrome

  !insertmacro ZY_BgInit

  nsDialogs::Show
FunctionEnd

Function ${ZY_UNPREFIX}ZYUnWelcomeLeave
  Return
FunctionEnd
!endif ; BUILD_UNINSTALLER
