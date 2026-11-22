import { app, powerSaveBlocker } from 'electron';

import { isEnterprise } from './appEnv';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import {
  APP_UPDATE_POLL_INTERVAL_MS,
  APP_UPDATE_STARTUP_DELAY_JITTER_MS,
  APP_UPDATE_STARTUP_DELAY_MIN_MS,
} from '../../shared/appUpdate/constants';
import { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import { McpCredentialVault } from '../libs/mcpCredentialVault';
import { McpStore } from '../mcpStore';
import { AgentManager } from '../agentManager';
import { CoworkStore } from '../coworkStore';
import { IMStore } from '../im/imStore';
import { ArtifactLedger } from '../artifactLedger/artifactLedger';
import { SkillManager } from '../skillManager';
import { ActivityService } from '../activity/activityService';
import { SqliteStore } from '../sqliteStore';
import { SqliteBackupManager } from '../libs/sqliteBackup/sqliteBackupManager';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';

const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;

const activeRunSleepBlockerIds = new Set<string>();
let manualPreventSleepEnabled = false;
let preventSleepBlockerId: number | null = null;

function isSleepBlockerActive(id: number | null): boolean {
  if (id === null) return false;
  return typeof powerSaveBlocker.isStarted === 'function' ? powerSaveBlocker.isStarted(id) : true;
}

function syncPreventSleepBlocker(): void {
  const shouldBlock = manualPreventSleepEnabled || activeRunSleepBlockerIds.size > 0;
  if (shouldBlock) {
    if (!isSleepBlockerActive(preventSleepBlockerId)) {
      preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (preventSleepBlockerId !== null && isSleepBlockerActive(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId);
  }
  preventSleepBlockerId = null;
}

export function setPreventSleepBlockerEnabled(enabled: boolean): void {
  manualPreventSleepEnabled = enabled;
  syncPreventSleepBlocker();
}

export function setActiveRunSleepBlocker(sessionId: string, active: boolean): void {
  if (active) {
    activeRunSleepBlockerIds.add(sessionId);
  } else {
    activeRunSleepBlockerIds.delete(sessionId);
  }
  syncPreventSleepBlocker();
}

export function clearActiveRunSleepBlockers(): void {
  activeRunSleepBlockerIds.clear();
  manualPreventSleepEnabled = false;
  syncPreventSleepBlocker();
}

const STORE_OPEN_TIMEOUT_MS = 15_000;
let store: SqliteStore | undefined;
let storeInitialization: Promise<SqliteStore> | undefined;
let sqliteBackupManager: SqliteBackupManager | undefined;

export const initStore = async (): Promise<SqliteStore> => {
  if (lifecycleRuntime.isQuitting) throw new Error('The application is shutting down.');
  if (storeInitialization) return storeInitialization;
  if (!app.isReady()) throw new Error('Store accessed before app is ready.');

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = SqliteStore.create(app.getPath('userData')).then(opened => {
    if (timedOut || lifecycleRuntime.isQuitting) {
      opened.close();
      throw new Error('Store initialization was abandoned.');
    }
    store = opened;
    return opened;
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Store initialization timed out after 15s'));
    }, STORE_OPEN_TIMEOUT_MS);
  });
  storeInitialization = Promise.race([opening, deadline]).finally(() => clearTimeout(timer));
  return storeInitialization;
};

export const getStoreIfOpen = () => store;

export const getStore = (): SqliteStore => {
  if (!store) throw new Error('Store not initialized. Call initStore() first.');
  return store;
};

export function closeStore(): void {
  store?.close();
  store = undefined;
}

export async function startSqliteBackupLoop(): Promise<void> {
  if (lifecycleRuntime.isQuitting) return;
  sqliteBackupManager ??= new SqliteBackupManager(app.getPath('userData'));
  await sqliteBackupManager.startPeriodicBackupLoop(() => getStore().getDatabase());
}

export function stopSqliteBackupLoop(): void {
  sqliteBackupManager?.stopPeriodicBackupLoop();
}

export function shutdownSqliteBackup() {
  return sqliteBackupManager?.shutdown();
}

let appUpdateCoordinator: AppUpdateCoordinator | undefined;
let lastSuccessfulAppUpdateCheckAt = 0;

export const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!appUpdateCoordinator) {
    if (lifecycleRuntime.isQuitting) throw new Error('The application is shutting down.');
    appUpdateCoordinator = new AppUpdateCoordinator(getStore(), undefined, undefined, {
      enterpriseBuild: isEnterprise,
    });
  }
  return appUpdateCoordinator;
};

const checkForAppUpdate = (): void => {
  if (lifecycleRuntime.isQuitting) return;
  void getAppUpdateCoordinator()
    .checkNow()
    .then(result => {
      if (result.success && !lifecycleRuntime.isQuitting)
        lastSuccessfulAppUpdateCheckAt = Date.now();
    });
};

export const checkForAppUpdateOnResume = (): void => {
  if (Date.now() - lastSuccessfulAppUpdateCheckAt >= APP_UPDATE_POLL_INTERVAL_MS) {
    checkForAppUpdate();
  }
};

let stopAppUpdateTimers: (() => void) | undefined;

export const startAppUpdatePolling = (): void => {
  // Enterprise builds receive updates through the enterprise distribution
  // channel; the client never runs startup or periodic update checks.
  if (isEnterprise || lifecycleRuntime.isQuitting || stopAppUpdateTimers) return;
  const startupDelay =
    APP_UPDATE_STARTUP_DELAY_MIN_MS +
    Math.floor(Math.random() * APP_UPDATE_STARTUP_DELAY_JITTER_MS);
  const initial = setTimeout(checkForAppUpdate, startupDelay);
  const poll = setInterval(checkForAppUpdate, APP_UPDATE_POLL_INTERVAL_MS);
  stopAppUpdateTimers = () => {
    clearTimeout(initial);
    clearInterval(poll);
  };
};

export const shutdownAppUpdates = (): Promise<void> | undefined => {
  stopAppUpdateTimers?.();
  stopAppUpdateTimers = undefined;
  return appUpdateCoordinator?.shutdown();
};

let coworkStore: CoworkStore | undefined;
let artifactLedger: ArtifactLedger | undefined;

export const getCoworkStore = () =>
  (coworkStore ??= new CoworkStore(getStore().getDatabase(), getArtifactLedger()));

let imStore: IMStore | undefined;
export const getIMStore = () => (imStore ??= new IMStore(getStore().getDatabase()));

/** Shared artifact ledger over the main SQLite database (event-time source of truth). */
export const getArtifactLedger = () =>
  (artifactLedger ??= new ArtifactLedger(getStore().getDatabase()));

let agentManager: AgentManager | undefined;
let skillManager: SkillManager | undefined;

export const getAgentManager = () => (agentManager ??= new AgentManager(getCoworkStore()));

export const getSkillManager = () => (skillManager ??= new SkillManager(getStore));

export function shutdownSkillManager(): Promise<void> | undefined {
  return skillManager?.shutdown();
}

let mcpStore: McpStore | undefined;

export const getMcpStore = () => {
  if (!mcpStore) {
    const sqliteStore = getStore();
    const nextMcpStore = new McpStore(
      sqliteStore.getDatabase(),
      new McpCredentialVault(sqliteStore),
    );
    nextMcpStore.migrateLegacyCredentials();
    mcpStore = nextMcpStore;
  }
  return mcpStore;
};

let scheduledTaskStore: SqliteScheduledTaskStore | undefined;

export const getScheduledTaskStore = () =>
  (scheduledTaskStore ??= new SqliteScheduledTaskStore(getStore().getDatabase()));

let activityService: ActivityService | undefined;

export const getActivityService = () =>
  (activityService ??= new ActivityService(getStore().getDatabase()));
