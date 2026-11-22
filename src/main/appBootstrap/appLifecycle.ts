/** App quit lifecycle: cleanup orchestration, termination-signal handling, quit logging. */
import { app, BrowserWindow } from 'electron';

import { lifecycleRuntime } from './lifecycleRuntimeState';
import { persistAppWindowState } from './windowManagement';
import type { MagpieRuntime } from './magpieRuntime';
import type { LocalInferenceRuntime } from './localInferenceRuntime';
import { stopTodoReminders } from '../todo/ipc';
import {
  clearActiveRunSleepBlockers,
  closeStore,
  getStoreIfOpen,
  shutdownAppUpdates,
  shutdownSkillManager,
  shutdownSqliteBackup,
} from './runtimeServices';
import { AppQuitOrigin, getAppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import { destroyTray } from '../trayManager';
import { disposeDesktopPet } from '../desktopPet/controller';
import { drainDesktopPetSensors } from '../desktopPet/windows/observer';
import { disposeCompanionWindow } from '../companion/window';
import { disposeZhiyuanEnterpriseExtension } from '../enterpriseExtension/host';
import { shutdownPythonRuntime } from '../pythonRuntime/host';
import { settleWithin } from '../libs/startupGate';
import { OWNED_PROCESS_STOP_TIMEOUT_MS } from '../libs/ownedProcessStop';
import { drainCcConnectIngress, stopCcConnectProcesses } from './ccConnectRuntime';
import { interruptCompanionChat } from './companionTasks';
import type { CodingRoomRuntime } from './codingRoomRuntime';
import { shutdownMcpBridge } from './mcpBootstrap';
import { shutdownMcpOAuthRefreshes } from './mcpOAuthHeaders';
import { drainSessionDirectoryRemovals } from '../removeSessionDirectory';
import { shutdownManagedSkillScripts } from '../libs/skillRuntimeRunner';
import {
  drainSettledRunPromotions,
  shutdownMemoryWrites,
  stopEngram,
  shutdownSessionRuntime,
} from './sessionServices';

let isCleanupFinished = false;
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
const MODEL_COMPLETION_QUIT_GRACE_MS = 2_000;
// Reserve time for the gateway quit request and escalation to process termination.
const MAGPIE_QUIT_RESERVE_MS = 4_500;
// Leave time for process termination, then give interrupted writers time to settle.
const ENGRAM_QUIT_RESERVE_MS = OWNED_PROCESS_STOP_TIMEOUT_MS + 500;
/** Steps slower than this are logged by name so the next quit regression is visible. */
const SLOW_CLEANUP_STEP_MS = 250;

type CleanupStep = {
  readonly name: string;
  readonly run: () => Promise<unknown> | void;
  readonly independentOfStore?: true;
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

type MagpieCleanup = Pick<
  MagpieRuntime,
  'closeAdmission' | 'disconnectExternalAgents' | 'shutdown' | 'stopManagedGateway'
>;

const runAppCleanup = async (
  timeoutMs: number,
  shutdownMcpAuthorizations: () => Promise<void>,
  magpie: MagpieCleanup,
  localInference: Pick<LocalInferenceRuntime, 'stop'>,
  stopCodingRoom: CodingRoomRuntime['stop'],
  startup: Promise<void>,
): Promise<boolean> => {
  console.log('[AppLifecycle] App cleanup started.');

  const { writes: pendingPromotions, modelCompletions } = drainSettledRunPromotions();
  const modelTransportsReadyToStop = settleWithin(
    modelCompletions,
    Math.min(MODEL_COMPLETION_QUIT_GRACE_MS, timeoutMs - MAGPIE_QUIT_RESERVE_MS),
  ).then(drained => {
    if (!drained) console.warn('[MemoryRuntime] Timed out draining model completions before quit.');
  });
  let memoryDrain: Promise<void> | undefined;
  let magpieAdmission: Promise<boolean> | undefined;
  let inferenceShutdown: ReturnType<LocalInferenceRuntime['stop']>;
  let backupShutdown: ReturnType<typeof shutdownSqliteBackup>;
  let codingRoomShutdown: ReturnType<CodingRoomRuntime['stop']>;
  let sessionShutdown: ReturnType<typeof shutdownSessionRuntime>;
  // Start admission stops in order, then drain the returned promises concurrently.
  const steps: CleanupStep[] = [
    { name: 'quitContext', independentOfStore: true, run: logAppQuitContextOnce },
    { name: 'startup', run: () => startup },
    { name: 'windowState', run: persistAppWindowState },
    { name: 'channelIngress', run: drainCcConnectIngress },
    { name: 'channelProcesses', independentOfStore: true, run: stopCcConnectProcesses },
    {
      name: 'sqliteBackupSource',
      run: () => (backupShutdown = shutdownSqliteBackup())?.sourceReleased,
    },
    {
      name: 'sqliteBackupPublication',
      independentOfStore: true,
      run: () => backupShutdown?.finished,
    },
    { name: 'appUpdates', run: shutdownAppUpdates },
    // Both abort before awaiting cleanup, and credential writes check that signal.
    { name: 'mcpAuthorizations', independentOfStore: true, run: shutdownMcpAuthorizations },
    { name: 'mcpOAuthRefreshes', independentOfStore: true, run: shutdownMcpOAuthRefreshes },
    { name: 'mcpBridge', independentOfStore: true, run: shutdownMcpBridge },
    { name: 'tray', independentOfStore: true, run: destroyTray },
    { name: 'desktopPet', run: disposeDesktopPet },
    { name: 'desktopPetSensors', independentOfStore: true, run: drainDesktopPetSensors },
    { name: 'companionRequests', run: disposeCompanionWindow },
    {
      name: 'skillWatcher',
      independentOfStore: true,
      run: shutdownSkillManager,
    },
    {
      name: 'magpieAdmission',
      run: () =>
        (magpieAdmission = magpie
          .closeAdmission()
          .then(
            () => getStoreIfOpen()?.get<boolean>('magpie_disconnect_external_on_quit') === true,
          )),
    },
    {
      name: 'magpieProcess',
      independentOfStore: true,
      run: async () => {
        try {
          const controller = new AbortController();
          const prepareToStop = magpieAdmission?.then(async shouldDisconnect => {
            if (shouldDisconnect && !controller.signal.aborted) {
              await magpie.disconnectExternalAgents(controller.signal);
            }
          });
          if (prepareToStop) {
            if (await settleWithin(prepareToStop, timeoutMs - MAGPIE_QUIT_RESERVE_MS)) {
              await prepareToStop;
            } else {
              controller.abort();
              console.warn(
                '[Magpie] Timed out draining settings or restoring external agents before quit.',
              );
            }
          }
        } catch (error) {
          console.warn('[Magpie] Failed to prepare the gateway for quit:', error);
        } finally {
          await modelTransportsReadyToStop;
          await magpie.shutdown();
        }
      },
    },
    {
      name: 'companionChat',
      run: () => {
        try {
          interruptCompanionChat();
        } catch (error) {
          // Interrupt closes admission before attempting the synchronous status write.
          console.warn('[AppLifecycle] Failed to persist companion chat interruptions:', error);
        }
      },
    },
    {
      name: 'sessionRuntime',
      run: () => (sessionShutdown = shutdownSessionRuntime())?.drained,
    },
    {
      name: 'cadViewer',
      independentOfStore: true,
      run: () => sessionShutdown?.viewerStopped,
    },
    { name: 'skillScripts', independentOfStore: true, run: shutdownManagedSkillScripts },
    { name: 'sessionDirectories', independentOfStore: true, run: drainSessionDirectoryRemovals },
    { name: 'preventSleep', independentOfStore: true, run: clearActiveRunSleepBlockers },
    { name: 'todoReminders', run: stopTodoReminders },
    { name: 'memoryPromotions', run: () => pendingPromotions },
    {
      name: 'managedModelTransport',
      independentOfStore: true,
      run: async () => {
        await modelTransportsReadyToStop;
        await magpie.stopManagedGateway();
      },
    },
    {
      name: 'enterpriseExtension',
      run: async () => {
        await modelTransportsReadyToStop;
        await disposeZhiyuanEnterpriseExtension();
      },
    },
    {
      name: 'pythonRuntime',
      independentOfStore: true,
      run: shutdownPythonRuntime,
    },
    {
      name: 'llamacppIngress',
      run: () => (inferenceShutdown = localInference.stop(modelTransportsReadyToStop))?.drained,
    },
    {
      name: 'llamacppProcess',
      independentOfStore: true,
      run: () => inferenceShutdown?.stopped,
    },
    {
      name: 'memoryWrites',
      run: () => (memoryDrain = shutdownMemoryWrites()),
    },
    {
      name: 'engramProcess',
      independentOfStore: true,
      run: async () => {
        if (memoryDrain && !(await settleWithin(memoryDrain, timeoutMs - ENGRAM_QUIT_RESERVE_MS))) {
          console.warn(
            '[MemoryRuntime] Stopping Engram before pending memory writes have drained.',
          );
        }
        await stopEngram();
      },
    },
    {
      name: 'codingRoomTurns',
      run: () => (codingRoomShutdown = stopCodingRoom())?.drained,
    },
    {
      name: 'codingRoomProbes',
      independentOfStore: true,
      run: () => codingRoomShutdown?.probesStopped,
    },
  ];

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  let databaseCleanupFailed = false;
  const pending = new Set(steps);
  const cleanup = Promise.all(
    steps.map(async step => {
      const stepStartedAt = Date.now();
      try {
        await step.run();
      } catch (error) {
        if (!step.independentOfStore) databaseCleanupFailed = true;
        console.error(`[AppLifecycle] Cleanup step ${step.name} failed:`, error);
      } finally {
        pending.delete(step);
        const elapsed = Date.now() - stepStartedAt;
        if (elapsed >= SLOW_CLEANUP_STEP_MS)
          console.log(`[AppLifecycle] Cleanup step ${step.name} took ${elapsed} ms.`);
      }
    }),
  );
  await Promise.race([cleanup, deadline]);
  clearTimeout(timer);

  if (pending.size)
    console.warn(
      `[AppLifecycle] Cleanup timed out with pending steps ${[...pending].map(step => step.name).join(', ')}.`,
    );
  return !databaseCleanupFailed && [...pending].every(step => step.independentOfStore);
};

export const registerAppLifecycleHandlers = (
  shutdownMcpAuthorizations: () => Promise<void>,
  magpie: MagpieCleanup,
  localInference: Pick<LocalInferenceRuntime, 'stop'>,
  stopCodingRoom: CodingRoomRuntime['stop'],
  startup: Promise<void>,
): void => {
  const startupSettled = startup.catch(error => {
    console.error('[AppLifecycle] Application startup failed:', error);
    if (lifecycleRuntime.isQuitting) return;
    recordAppQuitOrigin(AppQuitOrigin.StartupFailure);
    void beginAppCleanup(1);
  });

  const beginAppCleanup = async (exitCode = 0): Promise<void> => {
    if (lifecycleRuntime.isQuitting) return;
    lifecycleRuntime.isQuitting = true;
    try {
      const canCloseStore = await runAppCleanup(
        cleanupTimeoutForOrigin(getAppQuitOrigin()),
        shutdownMcpAuthorizations,
        magpie,
        localInference,
        stopCodingRoom,
        startupSettled,
      );
      // Close in the same turn as exit, once tracked database users have settled.
      if (canCloseStore) closeStore();
    } catch (error) {
      console.error('[AppLifecycle] Cleanup failed:', error);
    } finally {
      isCleanupFinished = true;
      app.exit(exitCode);
    }
  };

  app.on('before-quit', e => {
    if (isCleanupFinished) return;
    e.preventDefault();
    void beginAppCleanup();
  });

  const handleTerminationSignal = (signal: NodeJS.Signals, origin: AppQuitOrigin) => {
    if (lifecycleRuntime.isQuitting) return;
    recordAppQuitOrigin(origin);
    console.log(`[AppLifecycle] Received ${signal}; running cleanup before exit.`);
    void beginAppCleanup();
  };
  // Electron installs its POSIX handlers during startup. Register after readiness so
  // repeated signals reach cleanup's quit guard while SQLite users drain.
  void app.whenReady().then(() => {
    process.on('SIGINT', () => handleTerminationSignal('SIGINT', AppQuitOrigin.SignalInterrupt));
    process.on('SIGTERM', () => handleTerminationSignal('SIGTERM', AppQuitOrigin.SignalTerminate));
  });
};
