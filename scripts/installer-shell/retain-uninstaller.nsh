; Official NSIS compiler hook, after electron-builder has signed its native
; uninstaller but before NsisTarget deletes that intermediate executable.
; https://nsis.sourceforge.io/Docs/Chapter5.html#finalize
!ifdef APP_ID
!if "${APP_ID}" == "com.zhiyuanagent.app"
!ifdef UNINSTALLER_OUT_FILE
!ifdef BUILD_UNINSTALLER
  !system 'node "${PROJECT_DIR}\scripts\installer-shell\retain-uninstaller.cjs" reset "${PROJECT_DIR}"' = 0
!else
  !finalize 'node "${PROJECT_DIR}\scripts\installer-shell\retain-uninstaller.cjs" capture "${PROJECT_DIR}" "${UNINSTALLER_OUT_FILE}"' = 0
!endif
!endif
!endif
!endif
