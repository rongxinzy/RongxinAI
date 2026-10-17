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
import {
  CcConnectCronClient,
  SchedulerClockAccount,
} from '../../scheduledTask/ccConnectCronClient';
import { CanonicalScheduledTaskService } from '../../scheduledTask/canonicalScheduledTaskService';
import { CcConnectDeliveryClient } from '../../scheduledTask/ccConnectDeliveryClient';
import { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import { CcConnectSchedulerRuntime } from '../../scheduledTask/ccConnectSchedulerRuntime';
import { DeferredCcConnectCronClient } from '../../scheduledTask/deferredCcConnectCronClient';
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
import { createIMScheduledTaskRequestDetector } from '../im/imScheduledTaskHandler';
import { listCcConnectAccountConfigs } from '../libs/ccConnectAccountConfig';
import { parseCcConnectScopedConversationId } from '../im/ccConnectConversationId';
import { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import { CcConnectRuntimeStatusRegistry } from '../libs/ccConnectRuntimeStatusRegistry';
import { CcConnectSidecarManager } from '../libs/ccConnectSidecarManager';
import { serializeCcConnectSidecarConfig } from '../libs/ccConnectSidecarConfig';
import { resolveCcConnectAccountRuntimeStatus } from '../libs/ccConnectAccountRuntimeStatus';

const getScheduledTaskDetectorConfig = async (): Promise<{
  apiKey: string;
  baseUrl: string;
  model?: string;
  provider?: string;
} | null> => {
  const config = getStore().get<any>('app_config');
  for (const [provider, value] of Object.entries(config?.providers ?? {}) as Array<[string, any]>) {
    if (value?.enabled && value.apiKey)
      return {
        apiKey: value.apiKey,
        baseUrl: value.baseUrl,
        model: value.models?.[0]?.id,
        provider,
      };
  }
  return config?.api?.key
    ? { apiKey: config.api.key, baseUrl: config.api.baseUrl, model: config.model?.defaultModel }
    : null;
};
const attachCcConnectCronControl = async (
  accountId: string,
  baseUrl: string,
  expectedPid: number,
): Promise<Awaited<ReturnType<CcConnectCronClient['healthCheck']>>> => {
  if (!rt.ccConnectBridgeToken) throw new Error('cc-connect bridge token is not initialized');
  getCanonicalScheduledTaskService();
  const client = new CcConnectCronClient(baseUrl, rt.ccConnectBridgeToken);
  const health = await client.healthCheck(expectedPid);
  await rt.deferredCcConnectCronClient!.attach(accountId, client);
  // The sidecar intentionally has no durable task state. Rebuild its complete
  // trigger projection from SQLite after every successful control-plane attach.
  await rt.canonicalSchedulerRuntime!.reconcile(
    await getCanonicalScheduledTaskService().listJobs(),
  );
  return health;
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
  if (!rt.canonicalScheduledTaskService) {
    const taskStore = new SqliteScheduledTaskStore(getStore().getDatabase());
    rt.deferredCcConnectCronClient = new DeferredCcConnectCronClient();
    rt.ccConnectDeliveryTransport = new CcConnectDeliveryTransport(
      new IMStore(getStore().getDatabase()),
      getCoworkStore(),
    );
    const executor = new PiScheduledTaskExecutor(getPiRuntimeAdapter(), getCoworkStore());
    rt.activityService ??= new ActivityService(getStore().getDatabase());
    rt.canonicalSchedulerRuntime = new CcConnectSchedulerRuntime(
      taskStore,
      rt.deferredCcConnectCronClient,
      executor.execute.bind(executor),
      new ScheduledTaskDeliveryDispatcher(taskStore, rt.ccConnectDeliveryTransport),
      rt.activityService,
      {
        runUpdated: (run, taskName) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.RunUpdate, {
            run: { ...run, taskName },
          }),
        taskStateChanged: (taskId, state) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.StatusUpdate, { taskId, state }),
      },
    );
    rt.canonicalScheduledTaskService = new CanonicalScheduledTaskService(
      taskStore,
      rt.canonicalSchedulerRuntime,
    );
    rt.piRuntimeAdapter?.setScheduledTaskService(rt.canonicalScheduledTaskService);
  }
  return rt.canonicalScheduledTaskService;
};
export const startCcConnectBridge = async (): Promise<void> => {
  if (rt.ccConnectBridgeServer) return;
  const token = crypto.randomBytes(32).toString('base64url');
  rt.ccConnectBridgeToken = token;
  rt.ccConnectPiBridge = new CcConnectPiBridge({
    runtime: getPiRuntimeAdapter(),
    coworkStore: getCoworkStore(),
    imStore: new IMStore(getStore().getDatabase()),
    turnCoordinator: new ChannelTurnCoordinator(new ChannelInboxStore(getStore().getDatabase())),
    activityService:
      rt.activityService ?? (rt.activityService = new ActivityService(getStore().getDatabase())),
    getSkillsPrompt: async () => getSkillManager().buildAutoRoutingPrompt(),
    detectScheduledTaskRequest: createIMScheduledTaskRequestDetector({
      getLLMConfig: getScheduledTaskDetectorConfig,
    }),
    createScheduledTask: async ({ sessionId, message, request }) => {
      const [accountId, destination] = parseCcConnectScopedConversationId(message.conversationId);
      const session = getCoworkStore().getSession(sessionId);
      if (!session) throw new Error(`IM session not found: ${sessionId}`);
      const task = await getCanonicalScheduledTaskService().addJob({
        name: request.taskName,
        description: '',
        enabled: true,
        schedule: { kind: 'at', at: request.scheduleAt },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'agentTurn', message: request.payloadText },
        delivery: { mode: 'announce', channel: message.platform, to: destination, accountId },
        workspaceId: session.workspaceId,
        sessionKey: sessionId,
      });
      return {
        id: task.id,
        name: task.name,
        sessionKey: task.sessionKey,
        payloadText: request.payloadText,
        scheduleAt: request.scheduleAt,
      };
    },
    onCronTrigger: async trigger =>
      getCanonicalScheduledTaskService() &&
      rt.canonicalSchedulerRuntime!.handleTrigger({
        accountId: trigger.accountId,
        taskId: trigger.taskId,
        scheduleVersion: trigger.scheduleVersion,
        scheduledAt: trigger.scheduledAt,
      }),
  });
  rt.ccConnectBridgeServer = new CcConnectBridgeServer(token, {
    onTurn: (request, signal) => rt.ccConnectPiBridge!.runTurn(request, signal),
    onCronTrigger: trigger => rt.ccConnectPiBridge!.runCronTrigger(trigger),
  });
  rt.ccConnectBridgeUrl = await rt.ccConnectBridgeServer.start();
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
  accountId: string,
  baseUrl: string,
  expectedPid: number,
): Promise<Awaited<ReturnType<CcConnectCronClient['healthCheck']>>> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await attachCcConnectCronControl(accountId, baseUrl, expectedPid);
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
  statuses: Awaited<ReturnType<CcConnectCronClient['healthCheck']>>['platforms'],
): void => {
  rt.ccConnectRuntimeStatuses.replace(statuses);
};

export const refreshCcConnectPlatformStatuses = async (): Promise<void> => {
  if (!rt.ccConnectRuntimeControlClient || !rt.ccConnectSidecarManager?.running) return;
  const health = await rt.ccConnectRuntimeControlClient.healthCheck(
    rt.ccConnectSidecarManager.pid ?? undefined,
  );
  applyCcConnectPlatformStatuses(health.platforms);
};

const startCcConnectRuntime = async (
  accounts: ReturnType<typeof listCcConnectAccountConfigs>,
  signature: string,
): Promise<void> => {
  if (rt.ccConnectSidecarManager) return;
  if (!rt.ccConnectBridgeToken || !rt.ccConnectBridgeUrl)
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
    if (rt.ccConnectSidecarManager === manager) rt.ccConnectSidecarManager = null;
    rt.deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const account of accounts) {
      rt.ccConnectRuntimeStatuses.delete(account.accountId);
      rt.ccConnectDeliveryTransport?.detach(account.accountId);
      rt.ccConnectDeliveryAccounts.delete(account.accountId);
      rt.ccConnectRuntimeStatuses.markUnavailable(
        account.accountId,
        manager.lastError ?? `Channel runtime exited with code ${code ?? 'unknown'}`,
      );
    }
    console.warn(`[ChannelRuntime] Sidecar exited (code=${code}, signal=${signal})`);
    if (
      rt.ccConnectRuntimeStopping ||
      stopRequested ||
      !rt.ccConnectBridgeServer ||
      rt.ccConnectRuntimeRestartTimer
    )
      return;
    scheduleCcConnectRuntimeRestart();
  });
  rt.ccConnectSidecarManager = manager;
  try {
    await manager.start(
      serializeCcConnectSidecarConfig({
        dataDir: sidecarRoot,
        bridgeUrl: rt.ccConnectBridgeUrl,
        bridgeToken: rt.ccConnectBridgeToken,
        cronControlListen: '127.0.0.1:0',
        projects: [{ accountId: SchedulerClockAccount }, ...accounts],
      }),
    );
    const pid = manager.pid;
    if (!pid) throw new Error('cc-connect runtime has no child PID');
    const baseUrl = await manager.waitForControlUrl();
    const health = await waitForCcConnectCronControl(SchedulerClockAccount, baseUrl, pid);
    rt.ccConnectRuntimeControlClient = new CcConnectCronClient(baseUrl, rt.ccConnectBridgeToken);
    const client = new CcConnectDeliveryClient(baseUrl, rt.ccConnectBridgeToken);
    for (const account of accounts) {
      rt.ccConnectDeliveryTransport?.attach(account.accountId, client);
      rt.ccConnectDeliveryAccounts.add(account.accountId);
    }
    applyCcConnectPlatformStatuses(health.platforms);
    rt.ccConnectRuntimeConfigSignature = signature;
    rt.ccConnectRuntimeRestartAttempts = 0;
    console.log(`[ChannelRuntime] Started one runtime with ${accounts.length} channel account(s)`);
  } catch (error) {
    if (rt.ccConnectSidecarManager === manager) rt.ccConnectSidecarManager = null;
    rt.ccConnectRuntimeControlClient = null;
    rt.deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const account of accounts) {
      rt.ccConnectRuntimeStatuses.delete(account.accountId);
      rt.ccConnectDeliveryTransport?.detach(account.accountId);
      rt.ccConnectDeliveryAccounts.delete(account.accountId);
      rt.ccConnectRuntimeStatuses.markUnavailable(
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
  if (signature === rt.ccConnectRuntimeConfigSignature && rt.ccConnectSidecarManager?.running)
    return;
  rt.ccConnectRuntimeStopping = true;
  if (rt.ccConnectRuntimeRestartTimer) clearTimeout(rt.ccConnectRuntimeRestartTimer);
  rt.ccConnectRuntimeRestartTimer = null;
  try {
    await rt.ccConnectSidecarManager?.stop();
    rt.ccConnectSidecarManager = null;
    rt.ccConnectRuntimeControlClient = null;
    rt.deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const accountId of rt.ccConnectDeliveryAccounts)
      rt.ccConnectDeliveryTransport?.detach(accountId);
    rt.ccConnectDeliveryAccounts.clear();
    rt.ccConnectRuntimeStatuses.clear();
    rt.ccConnectRuntimeConfigSignature = '';
  } finally {
    rt.ccConnectRuntimeStopping = false;
  }
  await startCcConnectRuntime(accounts, signature);
};

export const reconcileCcConnectChannelSidecars = (): Promise<void> => {
  const operation = rt.ccConnectRuntimeReconcileQueue.then(
    reconcileCcConnectChannelSidecarsNow,
    reconcileCcConnectChannelSidecarsNow,
  );
  rt.ccConnectRuntimeReconcileQueue = operation.catch((): void => undefined);
  return operation;
};

const scheduleCcConnectRuntimeRestart = (): void => {
  if (rt.ccConnectRuntimeRestartTimer || !rt.ccConnectBridgeServer) return;
  const delayMs = Math.min(30_000, 1_000 * 2 ** rt.ccConnectRuntimeRestartAttempts);
  rt.ccConnectRuntimeRestartAttempts = Math.min(rt.ccConnectRuntimeRestartAttempts + 1, 5);
  rt.ccConnectRuntimeRestartTimer = setTimeout(() => {
    rt.ccConnectRuntimeRestartTimer = null;
    void reconcileCcConnectChannelSidecars().catch(error => {
      console.error('[ChannelRuntime] Failed to restart unified runtime:', error);
      scheduleCcConnectRuntimeRestart();
    });
  }, delayMs);
};

export const getIMGatewayManager = () => {
  if (!rt.imGatewayManager) {
    rt.imGatewayManager = new ChannelAccountManager(getStore().getDatabase(), async accountId => {
      await refreshCcConnectPlatformStatuses();
      return resolveCcConnectAccountRuntimeStatus(
        rt.ccConnectRuntimeStatuses,
        accountId,
        rt.ccConnectSidecarManager?.running === true,
      );
    });
  }
  return rt.imGatewayManager;
};
