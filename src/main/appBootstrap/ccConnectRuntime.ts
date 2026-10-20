/**
 * Unified cc-connect channel runtime: bridge server, sidecar process lifecycle,
 * canonical scheduled task service and the IM gateway manager. All mutable
 * runtime state lives in ./runtimeState.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { app, BrowserWindow } from 'electron';

import { rt } from './runtimeState';
import { getCoworkStore, getSkillManager, getStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { CcConnectControlClient } from '../libs/ccConnectControlClient';
import { CanonicalScheduledTaskService } from '../../scheduledTask/canonicalScheduledTaskService';
import { CcConnectDeliveryClient } from '../../scheduledTask/ccConnectDeliveryClient';
import { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import { CcConnectSchedulerRuntime } from '../../scheduledTask/ccConnectSchedulerRuntime';
import { LocalCronClock } from '../../scheduledTask/localCronClock';
import { ScheduledTaskDeliveryDispatcher } from '../../scheduledTask/deliveryDispatcher';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import { PiScheduledTaskExecutor } from '../../scheduledTask/piScheduledTaskExecutor';
import { IpcChannel as ScheduledTaskIpc } from '../../scheduledTask/constants';
import { ActivityService } from '../activity/activityService';
import { ChannelAccountManager } from '../im/channelAccountManager';
import { CcConnectPiBridge } from '../im/ccConnectPiBridge';
import { ChannelInboxStore } from '../im/channelInboxStore';
import { ChannelTurnCoordinator } from '../im/channelTurnCoordinator';
import { IMStore } from '../im/imStore';
import { listCcConnectAccountConfigs } from '../libs/ccConnectAccountConfig';
import { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import { CcConnectRuntimeStatusRegistry } from '../libs/ccConnectRuntimeStatusRegistry';
import { CcConnectSidecarManager } from '../libs/ccConnectSidecarManager';
import { serializeCcConnectSidecarConfig } from '../libs/ccConnectSidecarConfig';
import { resolveCcConnectAccountRuntimeStatus } from '../libs/ccConnectAccountRuntimeStatus';
import { channelRuntime } from './channelRuntimeState';

const attachCcConnectControl = async (
  baseUrl: string,
  expectedPid: number,
): Promise<Awaited<ReturnType<CcConnectControlClient['healthCheck']>>> => {
  if (!channelRuntime.bridgeToken) throw new Error('cc-connect bridge token is not initialized');
  // The scheduler clock is in-process; attach only verifies the sidecar health
  // contract. There is no cron projection to rebuild on attach anymore.
  return await new CcConnectControlClient(baseUrl, channelRuntime.bridgeToken).healthCheck(
    expectedPid,
  );
};
/**
 * Pushes canonical scheduler Run/status changes to every renderer window.
 * Scheduled Runs are started by the sidecar clock, so without this push the
 * task list and run history would keep showing pre-Run state until the next
 * user action.
 */
const broadcastScheduledTaskEvent = (
  channel: (typeof ScheduledTaskIpc)[keyof typeof ScheduledTaskIpc],
  data: Record<string, unknown>,
): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, data);
    } catch (error) {
      console.error('[Scheduler] failed to broadcast a scheduled task event:', error);
    }
  }
};

export const getCanonicalScheduledTaskService = (): CanonicalScheduledTaskService => {
  if (!channelRuntime.scheduledTaskService) {
    const taskStore = new SqliteScheduledTaskStore(getStore().getDatabase());
    channelRuntime.deliveryTransport = new CcConnectDeliveryTransport(
      new IMStore(getStore().getDatabase()),
      getCoworkStore(),
    );
    const executor = new PiScheduledTaskExecutor(getPiRuntimeAdapter(), getCoworkStore());
    channelRuntime.activityService ??= new ActivityService(getStore().getDatabase());
    // Main-process clock: timers survive sidecar restarts and fire with no
    // sidecar at all; triggers go straight into the runtime's claim path.
    channelRuntime.schedulerClock = new LocalCronClock((task, scheduledAtMs) => {
      void channelRuntime
        .schedulerRuntime!.handleTrigger({
          taskId: task.taskId,
          scheduleVersion: task.scheduleVersion,
          scheduledAt: new Date(scheduledAtMs).toISOString(),
        })
        .catch(error => console.error('[Scheduler] clock trigger failed:', error));
    });
    channelRuntime.schedulerRuntime = new CcConnectSchedulerRuntime(
      taskStore,
      channelRuntime.schedulerClock,
      executor.execute.bind(executor),
      new ScheduledTaskDeliveryDispatcher(taskStore, channelRuntime.deliveryTransport),
      channelRuntime.activityService,
      {
        runUpdated: (run, taskName) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.RunUpdate, {
            run: { ...run, taskName },
          }),
        taskStateChanged: (taskId, state) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.StatusUpdate, { taskId, state }),
      },
    );
    channelRuntime.scheduledTaskService = new CanonicalScheduledTaskService(
      taskStore,
      channelRuntime.schedulerRuntime,
    );
    rt.piRuntimeAdapter?.setScheduledTaskService(channelRuntime.scheduledTaskService);
    // Arm every enabled task's timer from SQLite at construction; the previous
    // design armed them only when the sidecar control plane attached.
    void (async () => {
      try {
        await channelRuntime.schedulerRuntime!.reconcile(
          await channelRuntime.scheduledTaskService.listJobs(),
        );
      } catch (error) {
        console.error('[Scheduler] startup scheduling failed:', error);
      }
    })();
  }
  return channelRuntime.scheduledTaskService;
};
export const startCcConnectBridge = async (): Promise<void> => {
  if (channelRuntime.bridgeServer) return;
  const token = crypto.randomBytes(32).toString('base64url');
  channelRuntime.bridgeToken = token;
  channelRuntime.piBridge = new CcConnectPiBridge({
    runtime: getPiRuntimeAdapter(),
    coworkStore: getCoworkStore(),
    imStore: new IMStore(getStore().getDatabase()),
    turnCoordinator: new ChannelTurnCoordinator(new ChannelInboxStore(getStore().getDatabase())),
    activityService:
      channelRuntime.activityService ??
      (channelRuntime.activityService = new ActivityService(getStore().getDatabase())),
    getSkillsPrompt: async () => getSkillManager().buildAutoRoutingPrompt(),
  });
  channelRuntime.bridgeServer = new CcConnectBridgeServer(token, {
    onTurn: (request, signal) => channelRuntime.piBridge!.runTurn(request, signal),
  });
  channelRuntime.bridgeUrl = await channelRuntime.bridgeServer.start();
};

export const resolveCcConnectSidecarExecutable = (): string | null => {
  const binary = process.platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const runtimeDirectories = [
    path.join(process.resourcesPath, 'channel-runtime'),
    path.join(app.getAppPath(), 'vendor', 'channel-runtime', 'current'),
  ];
  const candidates = runtimeDirectories.flatMap(directory => {
    try {
      const buildInfo = JSON.parse(
        fs.readFileSync(path.join(directory, 'runtime-build-info.json'), 'utf8'),
      ) as { binary?: unknown };
      return typeof buildInfo.binary === 'string'
        ? [path.join(directory, buildInfo.binary), path.join(directory, binary)]
        : [path.join(directory, binary)];
    } catch {
      return [path.join(directory, binary)];
    }
  });
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
};

const waitForCcConnectCronControl = async (
  baseUrl: string,
  expectedPid: number,
): Promise<Awaited<ReturnType<CcConnectControlClient['healthCheck']>>> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await attachCcConnectControl(baseUrl, expectedPid);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('cc-connect cron control did not become ready');
};

const applyCcConnectPlatformStatuses = (
  statuses: Awaited<ReturnType<CcConnectControlClient['healthCheck']>>['platforms'],
): void => {
  channelRuntime.statuses.replace(statuses);
};

export const refreshCcConnectPlatformStatuses = async (): Promise<void> => {
  if (!channelRuntime.controlClient || !channelRuntime.sidecarManager?.running) return;
  const health = await channelRuntime.controlClient.healthCheck(
    channelRuntime.sidecarManager.pid ?? undefined,
  );
  applyCcConnectPlatformStatuses(health.platforms);
};

const startCcConnectRuntime = async (
  accounts: ReturnType<typeof listCcConnectAccountConfigs>,
  signature: string,
): Promise<void> => {
  if (channelRuntime.sidecarManager) return;
  if (!channelRuntime.bridgeToken || !channelRuntime.bridgeUrl)
    throw new Error('cc-connect bridge is not initialized');
  const executable = resolveCcConnectSidecarExecutable();
  if (!executable) throw new Error('cc-connect runtime is not bundled');
  const sidecarRoot = path.join(app.getPath('userData'), 'cc-connect', 'runtime');
  const manager = new CcConnectSidecarManager(executable, path.join(sidecarRoot, 'config.toml'));
  let stopRequested = false;
  manager.on('stdout', line => console.debug(`[ChannelRuntime] ${line}`));
  manager.on('stderr', line => {
    if (/(?:^|\s)(?:level=)?ERROR(?:\s|$)/.test(line)) console.error(`[ChannelRuntime] ${line}`);
    else console.debug(`[ChannelRuntime] ${line}`);
  });
  manager.on('error', error => console.error('[ChannelRuntime] Sidecar error:', error));
  manager.on('exit', ({ code, signal }) => {
    if (channelRuntime.sidecarManager === manager) channelRuntime.sidecarManager = null;
    for (const account of accounts) {
      channelRuntime.statuses.delete(account.accountId);
      channelRuntime.deliveryTransport?.detach(account.accountId);
      channelRuntime.deliveryAccounts.delete(account.accountId);
      channelRuntime.statuses.markUnavailable(
        account.accountId,
        manager.lastError ?? `Channel runtime exited with code ${code ?? 'unknown'}`,
      );
    }
    console.warn(`[ChannelRuntime] Sidecar exited (code=${code}, signal=${signal})`);
    if (
      channelRuntime.stopping ||
      stopRequested ||
      !channelRuntime.bridgeServer ||
      channelRuntime.restartTimer
    )
      return;
    scheduleCcConnectRuntimeRestart();
  });
  channelRuntime.sidecarManager = manager;
  try {
    await manager.start(
      serializeCcConnectSidecarConfig({
        dataDir: sidecarRoot,
        bridgeUrl: channelRuntime.bridgeUrl,
        bridgeToken: channelRuntime.bridgeToken,
        cronControlListen: '127.0.0.1:0',
        projects: accounts,
      }),
    );
    const pid = manager.pid;
    if (!pid) throw new Error('cc-connect runtime has no child PID');
    const baseUrl = await manager.waitForControlUrl();
    const health = await waitForCcConnectCronControl(baseUrl, pid);
    channelRuntime.controlClient = new CcConnectControlClient(baseUrl, channelRuntime.bridgeToken);
    const client = new CcConnectDeliveryClient(baseUrl, channelRuntime.bridgeToken);
    for (const account of accounts) {
      channelRuntime.deliveryTransport?.attach(account.accountId, client);
      channelRuntime.deliveryAccounts.add(account.accountId);
    }
    applyCcConnectPlatformStatuses(health.platforms);
    channelRuntime.configSignature = signature;
    channelRuntime.restartAttempts = 0;
    console.log(`[ChannelRuntime] Started one runtime with ${accounts.length} channel account(s)`);
  } catch (error) {
    if (channelRuntime.sidecarManager === manager) channelRuntime.sidecarManager = null;
    channelRuntime.controlClient = null;
    for (const account of accounts) {
      channelRuntime.statuses.delete(account.accountId);
      channelRuntime.deliveryTransport?.detach(account.accountId);
      channelRuntime.deliveryAccounts.delete(account.accountId);
      channelRuntime.statuses.markUnavailable(
        account.accountId,
        error instanceof Error ? error.message : String(error),
      );
    }
    stopRequested = true;
    await manager.stop();
    throw error;
  }
};

const loadCcConnectChannelAccounts = () => {
  const accounts = listCcConnectAccountConfigs(new IMStore(getStore().getDatabase()), workspaceId =>
    Boolean(getCoworkStore().getWorkspace(workspaceId)),
  );
  console.log(`[ChannelRuntime] Found ${accounts.length} enabled channel account(s)`);
  return accounts;
};

/** Reconcile one process containing the scheduler and every enabled channel project. */
const reconcileCcConnectChannelSidecarsNow = async (): Promise<void> => {
  const accounts = loadCcConnectChannelAccounts();
  const signature = JSON.stringify(accounts);
  if (signature === channelRuntime.configSignature && channelRuntime.sidecarManager?.running)
    return;
  channelRuntime.stopping = true;
  if (channelRuntime.restartTimer) clearTimeout(channelRuntime.restartTimer);
  channelRuntime.restartTimer = null;
  try {
    await channelRuntime.sidecarManager?.stop();
    channelRuntime.sidecarManager = null;
    channelRuntime.controlClient = null;
    for (const accountId of channelRuntime.deliveryAccounts)
      channelRuntime.deliveryTransport?.detach(accountId);
    channelRuntime.deliveryAccounts.clear();
    channelRuntime.statuses.clear();
    channelRuntime.configSignature = '';
  } finally {
    channelRuntime.stopping = false;
  }
  await startCcConnectRuntime(accounts, signature);
};

export const reconcileCcConnectChannelSidecars = (): Promise<void> => {
  const operation = channelRuntime.reconcileQueue.then(
    reconcileCcConnectChannelSidecarsNow,
    reconcileCcConnectChannelSidecarsNow,
  );
  channelRuntime.reconcileQueue = operation.catch((): void => undefined);
  return operation;
};

const scheduleCcConnectRuntimeRestart = (): void => {
  if (channelRuntime.restartTimer || !channelRuntime.bridgeServer) return;
  const delayMs = Math.min(30_000, 1_000 * 2 ** channelRuntime.restartAttempts);
  channelRuntime.restartAttempts = Math.min(channelRuntime.restartAttempts + 1, 5);
  channelRuntime.restartTimer = setTimeout(() => {
    channelRuntime.restartTimer = null;
    void reconcileCcConnectChannelSidecars().catch(error => {
      console.error('[ChannelRuntime] Failed to restart unified runtime:', error);
      scheduleCcConnectRuntimeRestart();
    });
  }, delayMs);
};

export const getIMGatewayManager = () => {
  if (!channelRuntime.gatewayManager) {
    channelRuntime.gatewayManager = new ChannelAccountManager(
      getStore().getDatabase(),
      async accountId => {
        await refreshCcConnectPlatformStatuses();
        return resolveCcConnectAccountRuntimeStatus(
          channelRuntime.statuses,
          accountId,
          channelRuntime.sidecarManager?.running === true,
        );
      },
    );
  }
  return channelRuntime.gatewayManager;
};
