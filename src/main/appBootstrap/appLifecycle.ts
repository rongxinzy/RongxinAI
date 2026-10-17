/** App quit lifecycle: cleanup orchestration, termination-signal handling, quit logging. */
import { app, BrowserWindow } from 'electron';

import { rt } from './runtimeState';
import { getStore } from './runtimeServices';
import { getCronJobService } from '../ipcHandlers/scheduledTask';
import { AppQuitOrigin, getAppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import { destroyTray } from '../trayManager';
import { disposeZhiyuanEnterpriseExtension } from '../enterpriseExtension/host';
import { shutdownPythonRuntime } from '../pythonRuntime/host';
import { getSkillServiceManager } from '../skillServices';

let isCleanupFinished = false;
let isCleanupInProgress = false;
let hasLoggedAppQuitContext = false;

export const logAppQuitContextOnce = (): void => {
  if (hasLoggedAppQuitContext) return;
  hasLoggedAppQuitContext = true;

  const origin = getAppQuitOrigin();
  const windowCount = BrowserWindow.getAllWindows().length;
  const appImageContext = process.env.APPIMAGE ? ` from AppImage ${process.env.APPIMAGE}` : '';
  console.log(
    `[AppLifecycle] Quit requested by ${origin} on ${process.platform} with ${windowCount} open window(s) ` +
      `(pid ${process.pid}, executable ${process.execPath}${appImageContext}).`,
  );
};

const runAppCleanup = async (): Promise<void> => {
  console.log('[AppLifecycle] App cleanup started.');
  destroyTray();
  rt.skillManager?.stopWatching();

  await rt.disposeMagpie?.();
  rt.disposeMagpie = undefined;

  await disposeZhiyuanEnterpriseExtension().catch(error => {
    console.error('[EnterpriseExtension] Failed to dispose enterprise extension:', error);
  });

  rt.disposeMagpieModels?.();
  rt.disposeMagpieModels = undefined;

  // Stop all active Pi sessions without blocking shutdown.
  console.log('[Main] Stopping cowork sessions...');
  if (rt.piRuntimeAdapter) rt.piRuntimeAdapter.stopAllSessions();

  await shutdownPythonRuntime().catch(error => {
    console.error('[PythonRuntime] Failed to shut down Python runtime on quit:', error);
  });

  // Stop skill services.
  const skillServices = getSkillServiceManager();
  await skillServices.stopAll();

  await rt.ccConnectBridgeServer?.stop().catch(error => {
    console.error('[cc-connect] Failed to stop bridge on quit:', error);
  });
  rt.ccConnectBridgeServer = null;
  rt.ccConnectRuntimeStopping = true;
  if (rt.ccConnectRuntimeRestartTimer) clearTimeout(rt.ccConnectRuntimeRestartTimer);
  rt.ccConnectRuntimeRestartTimer = null;
  await rt.ccConnectSidecarManager?.stop();
  rt.ccConnectSidecarManager = null;
  rt.ccConnectRuntimeControlClient = null;

  if (rt.ollamaManager) {
    await rt.ollamaManager.shutdownForQuit().catch(error => {
      console.error('[Ollama] Failed to stop service on quit:', error);
    });
  }

  if (rt.llamaCppManager) {
    await rt.llamaCppManager.shutdownForQuit().catch(error => {
      console.error('[LlamaCpp] Failed to stop service on quit:', error);
    });
  }

  if (rt.llamaCppModelDaemonController) {
    await rt.llamaCppModelDaemonController.shutdownForQuit().catch(error => {
      console.error('[LlamaCppDaemon] Failed to stop local inference daemon on quit:', error);
    });
  }

  if (rt.engramManager) {
    await rt.engramManager.stop().catch(error => {
      console.error('[MemoryRuntime] Failed to stop local memory service:', error);
    });
  }

  if (rt.codingRoomService) {
    await rt.codingRoomService.dispose().catch(error => {
      console.error('[CodingRoom] Failed to dispose coding agent connections on quit:', error);
    });
  }

  // Stop the cron job polling
  try {
    getCronJobService().stopPolling();
  } catch {
    // The canonical scheduler may not have been initialized — safe to ignore.
  }

  rt.sqliteBackupManager?.stopPeriodicBackupLoop();
  rt.todoReminderScheduler?.stop();
  rt.todoReminderScheduler = null;

  // Close the SQLite database to flush the WAL and release the file lock.
  try {
    getStore().close();
  } catch {
    // Store may not have been initialized — safe to ignore.
  }
};

const handleTerminationSignal = (signal: NodeJS.Signals, origin: AppQuitOrigin) => {
  if (isCleanupFinished || isCleanupInProgress) {
    return;
  }
  recordAppQuitOrigin(origin);
  logAppQuitContextOnce();
  console.log(`[AppLifecycle] Received ${signal}; running cleanup before exit.`);
  isCleanupInProgress = true;
  rt.isQuitting = true;
  void runAppCleanup()
    .catch(error => {
      console.error(`[Main] Cleanup error during ${signal}:`, error);
    })
    .finally(() => {
      isCleanupFinished = true;
      isCleanupInProgress = false;
      app.exit(0);
    });
};

export const registerAppLifecycleHandlers = (): void => {
  app.on('before-quit', e => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    logAppQuitContextOnce();
    isCleanupInProgress = true;
    rt.isQuitting = true;

    // The cleanup chain stops many services sequentially with no per-service
    // deadline; a single wedged stop used to block app.exit(0) forever, which
    // on Windows turned update installs into an installer racing a live old
    // process. Bound the whole chain: whatever finishes first wins.
    const APP_QUIT_CLEANUP_TIMEOUT_MS = 15_000;
    const cleanupDeadline = new Promise<void>(resolve =>
      setTimeout(resolve, APP_QUIT_CLEANUP_TIMEOUT_MS).unref?.(),
    );

    void Promise.race([runAppCleanup(), cleanupDeadline])
      .catch(error => {
        console.error('[Main] Cleanup error:', error);
      })
      .finally(() => {
        if (isCleanupFinished) return;
        isCleanupFinished = true;
        isCleanupInProgress = false;
        console.log('[Main] App cleanup finished or timed out; exiting for quit.');
        app.exit(0);
      });
  });

  process.once('SIGINT', () => handleTerminationSignal('SIGINT', AppQuitOrigin.SignalInterrupt));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM', AppQuitOrigin.SignalTerminate));
};
