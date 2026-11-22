/**
 * cc-connect channel runtime: bridge server, sidecar lifecycle and IM gateway.
 */
import crypto from 'crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'path';
import { setTimeout as delay } from 'node:timers/promises';

import { app } from 'electron';

import {
  getActivityService,
  getCoworkStore,
  getIMStore,
  getSkillManager,
  getStore,
} from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { CcConnectControlClient } from '../libs/ccConnectControlClient';
import { CcConnectDeliveryClient } from '../../scheduledTask/ccConnectDeliveryClient';
import { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import { ChannelAccountManager } from '../im/channelAccountManager';
import { CcConnectPiBridge } from '../im/ccConnectPiBridge';
import { ChannelInboxStore } from '../im/channelInboxStore';
import { ChannelTurnCoordinator } from '../im/channelTurnCoordinator';
import { listCcConnectAccountConfigs } from '../libs/ccConnectAccountConfig';
import { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import { CcConnectSidecarManager } from '../libs/ccConnectSidecarManager';
import { serializeCcConnectSidecarConfig } from '../libs/ccConnectSidecarConfig';
import { resolveCcConnectAccountRuntimeStatus } from '../libs/ccConnectAccountRuntimeStatus';
import { CcConnectRuntimeStatusRegistry } from '../libs/ccConnectRuntimeStatusRegistry';
import { runCcConnectWeixinSetup, type WeixinSetupResult } from '../libs/ccConnectWeixinSetup';

/** State for cc-connect sidecars, bridge ingress and channel accounts. */
interface ChannelRuntimeState {
  gatewayManager: ChannelAccountManager | null;
  bridge: {
    server: CcConnectBridgeServer;
    handler: CcConnectPiBridge;
    token: string;
    url: string | null;
  } | null;
  bridgeClosing: Promise<void> | null;
  sidecarManager: CcConnectSidecarManager | null;
  statuses: CcConnectRuntimeStatusRegistry;
  restartTimer: NodeJS.Timeout | null;
  stopping: boolean;
  reconcileQueue: Promise<void>;
  configSignature: string;
  controlClient: CcConnectControlClient | null;
  delivery: CcConnectDeliveryTransport | null;
  restartAttempts: number;
}

const channelRuntime: ChannelRuntimeState = {
  gatewayManager: null,
  bridge: null,
  bridgeClosing: null,
  sidecarManager: null,
  statuses: new CcConnectRuntimeStatusRegistry(),
  restartTimer: null,
  stopping: false,
  reconcileQueue: Promise.resolve(),
  configSignature: '',
  controlClient: null,
  delivery: null,
  restartAttempts: 0,
};

const channelShutdown = new AbortController();
const pendingWeixinSetups = new Set<Promise<WeixinSetupResult>>();

export function getCcConnectDeliveryTransport(): CcConnectDeliveryTransport {
  return (channelRuntime.delivery ??= new CcConnectDeliveryTransport(
    getIMStore(),
    getCoworkStore().messages,
  ));
}

const startCcConnectBridge = async (): Promise<void> => {
  if (channelRuntime.bridge || channelShutdown.signal.aborted) return;
  const token = crypto.randomBytes(32).toString('base64url');
  const bridge = new CcConnectPiBridge({
    runtime: getPiRuntimeAdapter(),
    coworkStore: getCoworkStore(),
    imStore: getIMStore(),
    turnCoordinator: new ChannelTurnCoordinator(new ChannelInboxStore(getStore().getDatabase())),
    activityService: getActivityService(),
    getSkillsPrompt: async () => getSkillManager().buildAutoRoutingPrompt(),
  });
  const server = new CcConnectBridgeServer(token, {
    onTurn: (request, signal) => bridge.runTurn(request, signal),
  });
  const endpoint: NonNullable<ChannelRuntimeState['bridge']> = {
    server,
    handler: bridge,
    token,
    url: null,
  };
  channelRuntime.bridge = endpoint;
  try {
    endpoint.url = await server.start();
  } catch (error) {
    if (channelRuntime.bridge === endpoint) {
      channelRuntime.bridge = null;
      endpoint.handler.dispose();
    }
    if (!channelShutdown.signal.aborted) throw error;
  }
};

const resolveCcConnectSidecarExecutable = async (): Promise<string | null> => {
  const binary = process.platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const packagedBinary = path.join(process.resourcesPath, 'channel-runtime', binary);
  if (
    await access(packagedBinary).then(
      () => true,
      () => false,
    )
  )
    return packagedBinary;
  if (app.isPackaged) return null;

  const directory = path.join(app.getAppPath(), 'vendor', 'channel-runtime', 'current');
  const candidates = [path.join(directory, binary)];
  try {
    // A Windows host build can publish a revisioned binary while the previous executable is locked.
    const buildInfo = JSON.parse(
      await readFile(path.join(directory, 'runtime-build-info.json'), 'utf8'),
    ) as { binary?: unknown };
    if (typeof buildInfo.binary === 'string') {
      candidates.unshift(path.join(directory, buildInfo.binary));
    }
  } catch {
    // Downloaded development runtimes use the canonical binary name.
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

const waitForCcConnectCronControl = async (
  client: CcConnectControlClient,
  expectedPid: number,
): Promise<Awaited<ReturnType<CcConnectControlClient['healthCheck']>>> => {
  const { signal } = channelShutdown;
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    signal.throwIfAborted();
    try {
      return await client.healthCheck(expectedPid, signal);
    } catch (error) {
      lastError = error;
      await delay(250, undefined, { signal });
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
  const { controlClient, sidecarManager } = channelRuntime;
  if (!controlClient || !sidecarManager?.running || channelShutdown.signal.aborted) return;
  const health = await controlClient.healthCheck(
    sidecarManager.pid ?? undefined,
    channelShutdown.signal,
  );
  if (
    channelRuntime.controlClient === controlClient &&
    channelRuntime.sidecarManager === sidecarManager
  )
    applyCcConnectPlatformStatuses(health.platforms);
};

const startCcConnectRuntime = async (
  accounts: ReturnType<typeof listCcConnectAccountConfigs>,
  signature: string,
): Promise<void> => {
  if (accounts.length === 0 || channelRuntime.sidecarManager || channelShutdown.signal.aborted)
    return;
  const executable = await resolveCcConnectSidecarExecutable();
  if (channelShutdown.signal.aborted) return;
  if (!executable) throw new Error('cc-connect runtime is not bundled');
  await startCcConnectBridge();
  if (channelShutdown.signal.aborted) return;
  const endpoint = channelRuntime.bridge;
  if (!endpoint?.url) throw new Error('cc-connect bridge is not initialized');
  const { token: bridgeToken, url: bridgeUrl } = endpoint;
  const sidecarRoot = path.join(app.getPath('userData'), 'cc-connect', 'runtime');
  const delivery = getCcConnectDeliveryTransport();
  const manager = new CcConnectSidecarManager(executable, path.join(sidecarRoot, 'config.toml'));
  let stopRequested = false;
  manager.on('stdout', line => console.debug(`[ChannelRuntime] ${line}`));
  manager.on('stderr', line => {
    if (/(?:^|\s)(?:level=)?ERROR(?:\s|$)/.test(line)) console.error(`[ChannelRuntime] ${line}`);
    else console.debug(`[ChannelRuntime] ${line}`);
  });
  manager.on('error', error => console.error('[ChannelRuntime] Sidecar error:', error));
  manager.on('exit', ({ code, signal }) => {
    if (channelRuntime.sidecarManager !== manager) return;
    channelRuntime.sidecarManager = null;
    channelRuntime.controlClient = null;
    delivery.disconnect();
    for (const account of accounts) {
      channelRuntime.statuses.delete(account.accountId);
      channelRuntime.statuses.markUnavailable(
        account.accountId,
        manager.lastError ?? `Channel runtime exited with code ${code ?? 'unknown'}`,
      );
    }
    console.warn(`[ChannelRuntime] Sidecar exited (code=${code}, signal=${signal})`);
    if (
      channelRuntime.stopping ||
      stopRequested ||
      !channelRuntime.bridge ||
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
        bridgeUrl,
        bridgeToken,
        cronControlListen: '127.0.0.1:0',
        projects: accounts,
      }),
    );
    const pid = manager.pid;
    if (!pid) throw new Error('cc-connect runtime has no child PID');
    const baseUrl = await manager.waitForControlUrl(10_000, channelShutdown.signal);
    const controlClient = new CcConnectControlClient(baseUrl, bridgeToken);
    const health = await waitForCcConnectCronControl(controlClient, pid);
    if (channelShutdown.signal.aborted || channelRuntime.sidecarManager !== manager) return;
    channelRuntime.controlClient = controlClient;
    const client = new CcConnectDeliveryClient(baseUrl, bridgeToken);
    delivery.connect(
      accounts.map(account => account.accountId),
      client,
    );
    applyCcConnectPlatformStatuses(health.platforms);
    channelRuntime.configSignature = signature;
    channelRuntime.restartAttempts = 0;
    console.log(`[ChannelRuntime] Started one runtime with ${accounts.length} channel account(s)`);
  } catch (error) {
    if (channelShutdown.signal.aborted) return;
    channelRuntime.controlClient = null;
    delivery.disconnect();
    for (const account of accounts) {
      channelRuntime.statuses.delete(account.accountId);
      channelRuntime.statuses.markUnavailable(
        account.accountId,
        error instanceof Error ? error.message : String(error),
      );
    }
    stopRequested = true;
    await manager.stop();
    if (channelRuntime.sidecarManager === manager) channelRuntime.sidecarManager = null;
    throw error;
  }
};

const loadCcConnectChannelAccounts = () => {
  const accounts = listCcConnectAccountConfigs(getIMStore(), workspaceId =>
    Boolean(getCoworkStore().workspaces.getWorkspace(workspaceId)),
  );
  console.log(`[ChannelRuntime] Found ${accounts.length} enabled channel account(s)`);
  return accounts;
};

function cancelChannelRestart(): void {
  if (channelRuntime.restartTimer) clearTimeout(channelRuntime.restartTimer);
  channelRuntime.restartTimer = null;
}

async function stopCurrentCcConnectSidecar(): Promise<void> {
  const manager = channelRuntime.sidecarManager;
  channelRuntime.controlClient = null;
  if (manager) channelRuntime.delivery?.disconnect();
  await manager?.stop();
  if (channelRuntime.sidecarManager === manager) channelRuntime.sidecarManager = null;
  channelRuntime.statuses.clear();
  channelRuntime.configSignature = '';
}

function closeCcConnectIngress(): Promise<void> | undefined {
  if (channelRuntime.bridgeClosing) return channelRuntime.bridgeClosing;
  const endpoint = channelRuntime.bridge;
  if (!endpoint) return;
  channelRuntime.bridge = null;
  channelRuntime.bridgeClosing = endpoint.server.stop().finally(() => {
    channelRuntime.bridgeClosing = null;
    endpoint.handler.dispose();
  });
  return channelRuntime.bridgeClosing;
}

export function drainCcConnectIngress(): Promise<void> | undefined {
  channelRuntime.stopping = true;
  channelShutdown.abort();
  cancelChannelRestart();
  return closeCcConnectIngress();
}

export async function stopCcConnectProcesses(): Promise<void> {
  await Promise.all([
    channelRuntime.reconcileQueue.then(stopCurrentCcConnectSidecar),
    Promise.allSettled(pendingWeixinSetups),
  ]);
}

export async function setupCcConnectWeixin(
  action: 'start' | 'poll',
  qrcode?: string,
): Promise<WeixinSetupResult> {
  const { signal } = channelShutdown;
  signal.throwIfAborted();
  const operation = (async () => {
    const executable = await resolveCcConnectSidecarExecutable();
    if (!executable) throw new Error('Channel runtime is not bundled');
    const result = await runCcConnectWeixinSetup(executable, action, qrcode, signal);
    signal.throwIfAborted();
    return result;
  })();
  pendingWeixinSetups.add(operation);
  try {
    return await operation;
  } finally {
    pendingWeixinSetups.delete(operation);
  }
}

/** Reconcile one cc-connect process for all enabled channel accounts. */
const reconcileCcConnectChannelSidecarsNow = async (): Promise<void> => {
  if (channelShutdown.signal.aborted) return;
  const accounts = loadCcConnectChannelAccounts();
  const signature = JSON.stringify(accounts);
  if (signature === channelRuntime.configSignature && channelRuntime.sidecarManager?.running)
    return;
  channelRuntime.stopping = true;
  cancelChannelRestart();
  try {
    await stopCurrentCcConnectSidecar();
  } finally {
    try {
      if (accounts.length === 0) await closeCcConnectIngress();
    } finally {
      channelRuntime.stopping = channelShutdown.signal.aborted;
    }
  }
  await startCcConnectRuntime(accounts, signature);
};

export const reconcileCcConnectChannelSidecars = (): Promise<void> => {
  if (channelShutdown.signal.aborted) return Promise.resolve();
  const operation = channelRuntime.reconcileQueue.then(
    reconcileCcConnectChannelSidecarsNow,
    reconcileCcConnectChannelSidecarsNow,
  );
  channelRuntime.reconcileQueue = operation.catch((): void => undefined);
  return operation;
};

const scheduleCcConnectRuntimeRestart = (): void => {
  if (channelShutdown.signal.aborted || channelRuntime.restartTimer || !channelRuntime.bridge)
    return;
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

export function hasIMGatewayManager(): boolean {
  return channelRuntime.gatewayManager !== null;
}

export const getChannelAccountRuntimeStatus = (accountId: string) =>
  resolveCcConnectAccountRuntimeStatus(
    channelRuntime.statuses,
    accountId,
    channelRuntime.sidecarManager?.running === true,
  );

export const getIMGatewayManager = () => {
  if (!channelRuntime.gatewayManager) {
    channelRuntime.gatewayManager = new ChannelAccountManager(getIMStore(), async accountId => {
      await refreshCcConnectPlatformStatuses();
      return getChannelAccountRuntimeStatus(accountId);
    });
  }
  return channelRuntime.gatewayManager;
};
