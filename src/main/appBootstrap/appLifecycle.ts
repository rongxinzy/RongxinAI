/** App quit lifecycle: cleanup orchestration, termination-signal handling, quit logging. */
import { app, BrowserWindow } from 'electron';

import { lifecycleRuntime } from './lifecycleRuntimeState';
import { agentRuntime } from './agentRuntimeState';
import { storageRuntime } from './storageRuntimeState';
import { inferenceRuntime } from './inferenceRuntimeState';
import { memoryRuntime } from './memoryRuntimeState';
import { getStore } from './runtimeServices';
import { AppQuitOrigin, getAppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import { destroyTray } from '../trayManager';
import { disposeDesktopPet } from '../desktopPet/controller';
import { disposeZhiyuanEnterpriseExtension } from '../enterpriseExtension/host';
import { shutdownPythonRuntime } from '../pythonRuntime/host';
import { getSkillServiceManager } from '../skillServices';
import { channelRuntime } from './channelRuntimeState';

let isCleanupFinished = false;
let isCleanupInProgress = false;
let hasLoggedAppQuitContext = false;

/**
 * Upper bound for a normal quit. Independent services stop in parallel, so this
 * only matters when one of them wedges.
 */
const APP_QUIT_CLEANUP_TIMEOUT_MS = 15_000;
/**
 * Update installs must release the installer's file handles and get out of the
 * way; waiting the full normal budget makes the installer appear seconds late.
 */
const APP_UPDATE_INSTALL_CLEANUP_TIMEOUT_MS = 5_000;
/** Steps slower than this are logged by name so the next quit regression is visible. */
const SLOW_CLEANUP_STEP_MS = 250;

type CleanupStep = {
  readonly name: string;
  readonly run: () => Promise<unknown>;
};

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

const cleanupTimeoutForOrigin = (origin: AppQuitOrigin): number =>
  origin === AppQuitOrigin.UpdateInstall
    ? APP_UPDATE_INSTALL_CLEANUP_TIMEOUT_MS
    : APP_QUIT_CLEANUP_TIMEOUT_MS;

const runAppCleanup = async (): Promise<void> => {
  console.log('[AppLifecycle] App cleanup started.');

  // Stop anything that can still write before the services they write through
  // are taken down. These calls are synchronous and cheap.
  destroyTray();
  disposeDesktopPet();
  agentRuntime.skillManager?.stopWatching();

  inferenceRuntime.disposeMagpieModels?.();
  inferenceRuntime.disposeMagpieModels = undefined;

  // Stop all active Pi sessions without blocking shutdown.
  if (agentRuntime.piRuntimeAdapter) agentRuntime.piRuntimeAdapter.stopAllSessions();

  storageRuntime.sqliteBackupManager?.stopPeriodicBackupLoop();
  memoryRuntime.todoReminderScheduler?.stop();
  memoryRuntime.todoReminderScheduler = null;

  channelRuntime.stopping = true;
  if (channelRuntime.restartTimer) clearTimeout(channelRuntime.restartTimer);
  channelRuntime.restartTimer = null;

  let disconnectExternalAgents = false;
  try {
    disconnectExternalAgents =
      getStore().get<boolean>('magpie_disconnect_external_on_quit') === true;
  } catch {
    // Store may not have been initialized — safe to ignore.
  }

  // The steps are independent, so they run concurrently: the quit is bounded by
  // the slowest service instead of the sum of every service.
  const steps: CleanupStep[] = [
    {
      name: 'companions',
      run: async () => agentRuntime.piRuntimeAdapter?.closeCompanions(),
    },
    {
      name: 'magpie',
      run: async () => {
        if (disconnectExternalAgents) {
          await inferenceRuntime.magpieManager?.disconnectAllAgents().catch(error => {
            console.warn('[Magpie] Failed to disconnect external agents before quit:', error);
          });
        }
        await inferenceRuntime.disposeMagpie?.();
        inferenceRuntime.disposeMagpie = undefined;
      },
    },
    {
      name: 'enterpriseExtension',
      run: () =>
        disposeZhiyuanEnterpriseExtension().catch(error => {
          console.error('[EnterpriseExtension] Failed to dispose enterprise extension:', error);
        }),
    },
    {
      name: 'pythonRuntime',
      run: () =>
        shutdownPythonRuntime().catch(error => {
          console.error('[PythonRuntime] Failed to shut down Python runtime on quit:', error);
        }),
    },
    {
      name: 'skillServices',
      run: async () => {
        // Stop skill services.
        await getSkillServiceManager().stopAll();
      },
    },
    {
      name: 'channelRuntime',
      run: async () => {
        await channelRuntime.bridgeServer?.stop().catch(error => {
          console.error('[cc-connect] Failed to stop bridge on quit:', error);
        });
        channelRuntime.bridgeServer = null;
        await channelRuntime.sidecarManager?.stop();
        channelRuntime.sidecarManager = null;
        channelRuntime.controlClient = null;
      },
    },
    {
      name: 'ollama',
      run: async () => {
        if (!inferenceRuntime.ollamaManager) return;
        await inferenceRuntime.ollamaManager.shutdownForQuit().catch(error => {
          console.error('[Ollama] Failed to stop service on quit:', error);
        });
      },
    },
    {
      name: 'llamacpp',
      run: async () => {
        if (!inferenceRuntime.llamaCppManager) return;
        await inferenceRuntime.llamaCppManager.shutdownForQuit().catch(error => {
          console.error('[LlamaCpp] Failed to stop service on quit:', error);
        });
      },
    },
    {
      name: 'llamacppOrchestrator',
      run: async () => {
        if (!inferenceRuntime.llamaCppModelOrchestrator) return;
        await inferenceRuntime.llamaCppModelOrchestrator.shutdownForQuit().catch(error => {
          console.error('[LlamaCpp] Failed to stop local inference orchestrator on quit:', error);
        });
      },
    },
    {
      name: 'memoryRuntime',
      run: async () => {
        if (!memoryRuntime.engramManager) return;
        await memoryRuntime.engramManager.stop().catch(error => {
          console.error('[MemoryRuntime] Failed to stop local memory service:', error);
        });
      },
    },
    {
      name: 'codingRoom',
      run: async () => {
        if (!agentRuntime.codingRoomService) return;
        await agentRuntime.codingRoomService.dispose().catch(error => {
          console.error('[CodingRoom] Failed to dispose coding agent connections on quit:', error);
        });
      },
    },
  ];

  const results = await Promise.allSettled(
    steps.map(async step => {
      const stepStartedAt = Date.now();
      await step.run();
      const elapsed = Date.now() - stepStartedAt;
      if (elapsed >= SLOW_CLEANUP_STEP_MS) {
        console.log(`[AppLifecycle] Cleanup step ${step.name} took ${elapsed} ms.`);
      }
    }),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[AppLifecycle] Cleanup step ${steps[index].name} failed:`, result.reason);
    }
  });

  // Close the SQLite database to flush the WAL and release the file lock. This
  // stays after the services above because they may still read the store.
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
  lifecycleRuntime.isQuitting = true;
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
    lifecycleRuntime.isQuitting = true;

    // The cleanup chain stops many services with no per-service deadline; a
    // single wedged stop used to block app.exit(0) forever, which on Windows
    // turned update installs into an installer racing a live old process.
    // Update installs use a shorter budget so the installer starts promptly.
    const timeoutMs = cleanupTimeoutForOrigin(getAppQuitOrigin());
    const cleanupDeadline = new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref?.());

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
