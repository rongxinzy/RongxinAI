; zy-theme.nsh — palette, geometry constants and drawing helpers for the fully
; custom ZhiYuan Agent installer UI (docs/2026-10-11-windows-installer-custom-ui.zh-CN.md).
;
; Geometry baseline (MUI2-faithful preview measurements, 96 DPI): wizard
; client 497x333, page content (inner 1018) 450x210px = 300x140 dialog units
; (1u = 1.5px both axes), header strip 497x63px. The branded background is hosted by SS_BITMAP statics:
; BgImage cannot paint inside the NSIS window (its surface sits behind the
; wizard), so the header strip and the page art are separate bitmap controls.
;
; Colors are COLORREFs (0xBBGGRR). Page layouts use nsDialogs units and take
; their positions from the constants below; the progress-page controls are raw
; Win32 children of $HWNDPARENT and lay out in pixels relative to the inner
; dialog rect (mapped via MapWindowPoints).

!ifndef ZY_THEME_INCLUDED
!define ZY_THEME_INCLUDED

!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

; ---------------------------------------------------------------------------
; Palette. NSIS SetCtlColors takes 0x00RRGGBB values (it converts to GDI
; COLORREF internally); the generator's flat zones must match ZY_COLOR_BG
; exactly so label brushes blend into the bitmap art.
; ---------------------------------------------------------------------------
!define ZY_COLOR_BRAND  0x0F6BF2   ; #0F6BF2 primary actions / progress fill
!define ZY_COLOR_TEXT   0x1F2937   ; #1F2937 body text
!define ZY_COLOR_MUTED  0x6B7280   ; #6B7280 secondary text
!define ZY_COLOR_BORDER 0xE5E7EB   ; #E5E7EB track / hairlines
!define ZY_COLOR_BG     0xF5F9FF   ; #F5F9FF flat zone under the bitmap art

; ---------------------------------------------------------------------------
; Typography (points; Segoe UI covers Latin, GDI font linking picks up
; Microsoft YaHei UI for CJK glyphs on Chinese Windows)
; ---------------------------------------------------------------------------
!define ZY_FONT_FAMILY "Segoe UI"
!define ZY_FONT_TITLE_SIZE  14
!define ZY_FONT_TITLE_WT    600
!define ZY_FONT_BODY_SIZE   9
!define ZY_FONT_BODY_WT     400
!define ZY_FONT_HINT_SIZE   8
!define ZY_FONT_HINT_WT     400
!define ZY_FONT_BUTTON_WT   600

; ---------------------------------------------------------------------------
; Page geometry (dialog units). Content area ~300x140u at 96 DPI.
; ---------------------------------------------------------------------------
!define ZY_ROW_X 16u            ; shared left margin

; Hero page
!define ZY_HERO_WORDMARK_X 16u
!define ZY_HERO_WORDMARK_Y 2u
!define ZY_HERO_WORDMARK_W 60u
!define ZY_HERO_WORDMARK_H 27u
!define ZY_HERO_TITLE_Y 33u
!define ZY_HERO_TITLE_H 14u
!define ZY_HERO_TAGLINE_Y 50u
!define ZY_HERO_TAGLINE_H 11u
!define ZY_HERO_PATH_Y 69u
!define ZY_HERO_PATH_W 198u
!define ZY_HERO_PATH_H 14u
!define ZY_HERO_BROWSE_X 222u
!define ZY_HERO_BROWSE_Y 68u
!define ZY_HERO_BROWSE_W 44u
!define ZY_HERO_BROWSE_H 15u
!define ZY_HERO_INFER_Y 90u
!define ZY_HERO_INFER_W 210u
!define ZY_HERO_INFER_H 11u
!define ZY_HERO_HINT_X 30u
!define ZY_HERO_HINT_Y 100u
!define ZY_HERO_HINT_W 256u
!define ZY_HERO_HINT_H 10u
!define ZY_HERO_HINT2_Y 110u
!define ZY_HERO_HINT2_H 10u
!define ZY_HERO_LICENSE_X 16u
!define ZY_HERO_LICENSE_Y 122u
!define ZY_HERO_LICENSE_W 70u
!define ZY_HERO_LICENSE_H 10u
!define ZY_HERO_LINK_X 90u
!define ZY_HERO_LINK_Y 122u
!define ZY_HERO_LINK_W 62u
!define ZY_HERO_LINK_H 10u
!define ZY_HERO_INSTALL_X 248u
!define ZY_HERO_CANCEL_X 196u
!define ZY_HERO_CANCEL_W 44u
!define ZY_HERO_INSTALL_Y 120u
!define ZY_HERO_INSTALL_W 52u
!define ZY_HERO_INSTALL_H 13u

; Finish page
!define ZY_FINISH_GLYPH_X 126u
!define ZY_FINISH_GLYPH_Y 30u
!define ZY_FINISH_GLYPH_W 48u
!define ZY_FINISH_GLYPH_H 48u
!define ZY_FINISH_TITLE_Y 84u
!define ZY_FINISH_TITLE_H 14u
!define ZY_FINISH_BTN_Y 108u
!define ZY_FINISH_BTN_H 15u
!define ZY_FINISH_FINISH_X 48u
!define ZY_FINISH_FINISH_W 68u
!define ZY_FINISH_LAUNCH_X 124u
!define ZY_FINISH_LAUNCH_W 128u

; Uninstaller confirmation
!define ZY_UNWELCOME_TITLE_X 24u
!define ZY_UNWELCOME_TITLE_Y 48u
!define ZY_UNWELCOME_TITLE_W 252u
!define ZY_UNWELCOME_TITLE_H 14u
!define ZY_UNWELCOME_TEXT_Y 68u
!define ZY_UNWELCOME_TEXT_W 252u
!define ZY_UNWELCOME_TEXT_H 24u

; ---------------------------------------------------------------------------
; Progress bar geometry (pixels) and phase animation
; ---------------------------------------------------------------------------
!define ZY_BAR_W          400      ; display width; assets are 600x28
!define ZY_BAR_H          20       ; near-uniform with the asset aspect
!define ZY_PHASE_TOTAL    10       ; ZY_ProgressPhase call sites in customInstall
!define ZY_ANIM_FRAMES    16
!define ZY_ANIM_DELAY_MS  15
; Progress composition (fractions of the inner dialog height)
!define ZY_PROG_TITLE_Y   40       ; title row, percent of content height
!define ZY_PROG_PHASE_DY  40       ; phase text offset below the title, px
!define ZY_PROG_BAR_Y     68       ; bar row, percent of content height

; Staged asset names inside $PLUGINSDIR (see ZY_StageUiAssets)
!define ZY_ASSET_BAND     "$PLUGINSDIR\zy-band.bmp"
!define ZY_ASSET_BG       "$PLUGINSDIR\zy-bg.bmp"
!define ZY_ASSET_WORDMARK "$PLUGINSDIR\zy-wordmark.bmp"
!define ZY_ASSET_BAR_FILL "$PLUGINSDIR\zy-bar-fill.bmp"
!define ZY_ASSET_BAR_DONE "$PLUGINSDIR\zy-bar-complete.bmp"
!define ZY_ASSET_BAR_TRACK "$PLUGINSDIR\zy-bar-track.bmp"
!define ZY_ASSET_DONE     "$PLUGINSDIR\zy-done.bmp"
!define ZY_ASSET_LICENSE  "$PLUGINSDIR\zy-license.txt"

; ---------------------------------------------------------------------------
; ZY_StageUiAssets — extract the UI bitmaps (and license text) into
; $PLUGINSDIR. Called from customInit and customUnInit, which also run for
; silent installs: File extraction only, never GUI calls.
; ---------------------------------------------------------------------------
!macro ZY_StageUiAssets
  SetOutPath "$PLUGINSDIR"
  File /oname=zy-band.bmp "${PROJECT_DIR}\build\installer-assets\zy-band.bmp"
  File /oname=zy-bg.bmp "${PROJECT_DIR}\build\installer-assets\zy-bg.bmp"
  File /oname=zy-wordmark.bmp "${PROJECT_DIR}\build\installer-assets\zy-wordmark.bmp"
  File /oname=zy-bar-fill.bmp "${PROJECT_DIR}\build\installer-assets\zy-bar-fill.bmp"
  File /oname=zy-bar-complete.bmp "${PROJECT_DIR}\build\installer-assets\zy-bar-complete.bmp"
  File /oname=zy-bar-track.bmp "${PROJECT_DIR}\build\installer-assets\zy-bar-track.bmp"
  File /oname=zy-done.bmp "${PROJECT_DIR}\build\installer-assets\zy-done.bmp"
  ; The license text is generated next to the bitmaps; guard the build so a
  ; missing dev artifact degrades to a runtime notice instead of a compile
  ; error (ZY_UI_LICENSE_MISSING).
  !if /fileexists "${PROJECT_DIR}\build\installer-assets\license.txt"
    File /oname=zy-license.txt "${PROJECT_DIR}\build\installer-assets\license.txt"
    StrCpy $zyLicenseAvailable "1"
  !else
    StrCpy $zyLicenseAvailable "0"
  !endif
  SetOutPath $INSTDIR
!macroend

; ---------------------------------------------------------------------------
; ZY_BrandHeader — hide the native header chrome (background 1034, separator
; 1036, title 1037, subtitle 1038, icon 1039, image 1046/1047) and paint the
; branded header strip across the freed area, down to the top of the inner
; dialog, so no stock artwork or gray background shows through.
; ---------------------------------------------------------------------------
; ---------------------------------------------------------------------------
; ZY_SetImage CONTROL PATH — LoadAndSetImage /STRINGID /RESIZETOFIT
; replacement. electron-builder's bundled NSIS (3.0.4.1) predates the
; built-in LoadAndSetImage command, and a plain SS_BITMAP static does not
; scale — it clips the bitmap at native size (the generated art is 2x).
; So: load the bitmap, StretchBlt it onto a bitmap sized to the control's
; client rect (HALFTONE for downscaling quality), hand that to the static.
; Clobbers nothing: all registers are saved and restored.
; ---------------------------------------------------------------------------
!macro ZY_SetImage CONTROL PATH
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R9 ${CONTROL}
  System::Call 'user32::LoadImageW(i 0, t "${PATH}", i ${IMAGE_BITMAP}, i 0, i 0, i ${LR_LOADFROMFILE}) i .R1'
  System::Alloc 16
  Pop $R2
  System::Call 'user32::GetClientRect(i R9, p R2)'
  System::Call '*$R2(i, i, i .R3, i .R4)'
  System::Free $R2
  System::Call 'user32::GetDC(i R9) i .R5'
  System::Call 'gdi32::CreateCompatibleDC(i R5) i .R6'
  System::Call 'gdi32::CreateCompatibleBitmap(i R5, i R3, i R4) i .R7'
  System::Call 'gdi32::SelectObject(i R6, i R7) i .R2'
  System::Call 'user32::ReleaseDC(i R9, i R5)'
  System::Alloc 24
  Pop $R8
  System::Call 'gdi32::GetObjectW(i R1, i 24, p R8)'
  System::Call '*$R8(i, i .R0, i .R5)'
  System::Free $R8
  System::Call 'gdi32::CreateCompatibleDC(i 0) i .R8'
  System::Call 'gdi32::SelectObject(i R8, i R1) i'
  System::Call 'gdi32::SetStretchBltMode(i R6, i 4)'
  System::Call 'gdi32::StretchBlt(i R6, i 0, i 0, i R3, i R4, i R8, i 0, i 0, i R0, i R5, i 0x00CC0020)'
  System::Call 'gdi32::DeleteDC(i R8)'
  System::Call 'gdi32::DeleteObject(i R1)'
  System::Call 'gdi32::SelectObject(i R6, i R2)'
  System::Call 'gdi32::DeleteDC(i R6)'
  SendMessage $R9 ${STM_SETIMAGE} ${IMAGE_BITMAP} $R7
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro ZY_BrandHeader
  GetDlgItem $0 $HWNDPARENT 1034
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1046
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1047
  ShowWindow $0 ${SW_HIDE}

  ; Inner dialog top in client coordinates = header strip height.
  FindWindow $0 "#32770" "" $HWNDPARENT
  StrCmp $0 0 zy_header_done
  System::Alloc 16
  Pop $R1
  System::Call 'user32::GetWindowRect(i $0, p R1)'
  System::Call 'user32::MapWindowPoints(i 0, i $HWNDPARENT, p R1, i 2)'
  System::Call '*$R1(i .R2, i .R3, i .R4, i .R5)'
  System::Free $R1
  ; Client width.
  System::Alloc 16
  Pop $R1
  System::Call 'user32::GetClientRect(i $HWNDPARENT, p R1)'
  System::Call '*$R1(i .R6, i .R7, i .R8, i .R9)'
  System::Free $R1
  System::Call 'user32::CreateWindowExW(i 0, t "STATIC", t "", i 0x5000000E, i 0, i 0, i $R8, i $R3, i $HWNDPARENT, i 0, i 0, i 0) i .R6'
  !insertmacro ZY_SetImage $R6 "${ZY_ASSET_BAND}"
  zy_header_done:
!macroend

; ---------------------------------------------------------------------------
; ZY_HideMuiChrome — brand the header; kept as the name pages already call.
; ---------------------------------------------------------------------------
!macro ZY_HideMuiChrome
  !insertmacro ZY_BrandHeader
!macroend

; ---------------------------------------------------------------------------
; ZY_HideWizardButtons — hide the native Next (1) and Back (3) buttons.
; (modern.exe: 1 = Next, 2 = Cancel, 3 = Back.)
; ---------------------------------------------------------------------------
!macro ZY_HideWizardButtons
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
!macroend

; ---------------------------------------------------------------------------
; ZY_BgInit — paint the branded page background over the current nsDialogs
; page. Call this LAST in the page create function: nsDialogs stacks each new
; control at the bottom of the z-order, so the first-created control ends up
; on top; creating the art after the content keeps it underneath. The bitmap
; matches the 450x210 content area, so the stretch is uniform at 96 DPI, and
; its flat zone carries all text rows.
; ---------------------------------------------------------------------------
!macro ZY_BgInit
!ifndef ZY_NO_BG
  ${NSD_CreateBitmap} 0 0 100% 100% ""
  Pop $zyBgBitmap
  ${NSD_SetStretchedImage} $zyBgBitmap "${ZY_ASSET_BG}" $zyBgImage
!endif
!macroend

; ---------------------------------------------------------------------------
; ZY_SetFont HWND SIZE WEIGHT — create a Segoe UI font and apply it.
; $zyFont holds the latest handle; the few handles leak per wizard run by
; design (NSIS installers exit within minutes).
; ---------------------------------------------------------------------------
!macro ZY_SetFont HWND SIZE WEIGHT
  CreateFont $zyFont "${ZY_FONT_FAMILY}" "${SIZE}" "${WEIGHT}"
  SendMessage ${HWND} ${WM_SETFONT} $zyFont 1
!macroend

; ---------------------------------------------------------------------------
; ZY_LabelStyle HWND COLOR — solid page-tint background matching the bitmap
; flat zone. (The progress-page labels use "transparent" instead and repaint
; via ZY_RepaintLabelBehind on text changes.)
; ---------------------------------------------------------------------------
!macro ZY_LabelStyle HWND COLOR
  SetCtlColors ${HWND} "${COLOR}" "${ZY_COLOR_BG}"
!macroend

; ---------------------------------------------------------------------------
; ZY_RepaintLabelBehind HWND transparent statics do not erase their old
; glyphs when their text changes, so after WM_SETTEXT invalidate the label
; rect on the parent: the wizard repaints (background art included) and the
; label draws its new text on the fresh surface.
; ---------------------------------------------------------------------------
!macro ZY_RepaintLabelBehind HWND
  System::Alloc 16
  Pop $R1
  System::Call 'user32::GetWindowRect(i ${HWND}, p R1)'
  System::Call 'user32::MapWindowPoints(i 0, i $HWNDPARENT, p R1, i 2)'
  System::Call 'user32::RedrawWindow(i $HWNDPARENT, p R1, i 0, i 0x105)'
  System::Free $R1
!macroend

; ---------------------------------------------------------------------------
; ZY_ProgressPhase TOKEN TEXT - install-stage boundary hook invoked from
; customInstall (TOKEN makes the internal labels unique per call site).
; Updates the phase label and animates the fill bar by sliding the
; track-colored mask over it; the final phase swaps in the complete bar.
; Silent installs skip the animation entirely (no page ever ran).
; ---------------------------------------------------------------------------
!macro ZY_ProgressPhase TOKEN TEXT
  ${IfNot} ${Silent}
  ${AndIf} $zyPhaseLabel != ""
    IntOp $zyPhaseCount $zyPhaseCount + 1
    SendMessage $zyPhaseLabel ${WM_SETTEXT} 0 "STR:${TEXT}"
    !insertmacro ZY_RepaintLabelBehind $zyPhaseLabel
    ; Target fill width for this phase index.
    IntOp $0 $zyPhaseCount * ${ZY_BAR_W}
    IntOp $0 $0 / ${ZY_PHASE_TOTAL}
    IntOp $1 $0 - $zyCurFill
    IntOp $2 $1 / ${ZY_ANIM_FRAMES}
    StrCpy $3 0
    ZY_ProgressPhase_anim_${TOKEN}:
      IntOp $4 $zyCurFill + $2
      IntOp $5 $3 + 1
      ${If} $5 == ${ZY_ANIM_FRAMES}
        StrCpy $4 $0
      ${EndIf}
      StrCpy $zyCurFill $4
      IntOp $6 ${ZY_BAR_W} - $zyCurFill
      IntOp $7 $zyBarX + $zyCurFill
      ${If} $6 <= 0
        ShowWindow $zyMask ${SW_HIDE}
      ${Else}
        ShowWindow $zyMask ${SW_SHOW}
        System::Call 'user32::MoveWindow(i $zyMask, i $7, i $zyBarY, i $6, i ${ZY_BAR_H}, i 1)'
      ${EndIf}
      ${If} $zyCurFill >= ${ZY_BAR_W}
        ShowWindow $zyFill ${SW_HIDE}
        ShowWindow $zyComplete ${SW_SHOW}
      ${EndIf}
      ${If} $5 < ${ZY_ANIM_FRAMES}
        Sleep ${ZY_ANIM_DELAY_MS}
      ${EndIf}
      IntOp $3 $3 + 1
      IntCmp $3 ${ZY_ANIM_FRAMES} ZY_ProgressPhase_done_${TOKEN} ZY_ProgressPhase_anim_${TOKEN} ZY_ProgressPhase_anim_${TOKEN}
    ZY_ProgressPhase_done_${TOKEN}:
  ${EndIf}
!macroend

!endif ; ZY_THEME_INCLUDED
