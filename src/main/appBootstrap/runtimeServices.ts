import { app, powerSaveBlocker } from 'electron';

import { isEnterprise } from './appEnv';
import { rt } from './runtimeState';
import {
  APP_UPDATE_POLL_INTERVAL_MS,
  APP_UPDATE_STARTUP_DELAY_JITTER_MS,
  APP_UPDATE_STARTUP_DELAY_MIN_MS,
} from '../../shared/appUpdate/constants';
import { getLlamaCppServiceConfig } from '../ipcHandlers/llamacpp';
import { getOllamaServiceConfig } from '../ipcHandlers/ollama';
import { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import { LlamaCppManager } from '../libs/llamacppManager';
import { OllamaManager } from '../libs/ollamaManager';
import { McpCredentialVault } from '../libs/mcpCredentialVault';
import { McpStore } from '../mcpStore';
import { AgentManager } from '../agentManager';
import { CoworkStore } from '../coworkStore';
import { SkillManager } from '../skillManager';
import { SqliteStore } from '../sqliteStore';

const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;

export function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (
      rt.preventSleepBlockerId === null ||
      !powerSaveBlocker.isStarted(rt.preventSleepBlockerId)
    ) {
      rt.preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (rt.preventSleepBlockerId !== null && powerSaveBlocker.isStarted(rt.preventSleepBlockerId)) {
    powerSaveBlocker.stop(rt.preventSleepBlockerId);
  }
  rt.preventSleepBlockerId = null;
}

export const initStore = async (): Promise<SqliteStore> => {
  if (!rt.storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    // better-sqlite3 opens the database synchronously, so Promise.resolve() resolves
    // immediately. The timeout acts as a safety net for unexpected OS-level
    // blocking during store initialization and recovery.
    rt.storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000),
      ),
    ]);
  }
  return rt.storeInitPromise;
};

export const getStore = (): SqliteStore => {
  if (!rt.store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return rt.store;
};

export const getLlamaCppManager = (): LlamaCppManager => {
  if (!rt.llamaCppManager) {
    rt.llamaCppManager = new LlamaCppManager(() => getLlamaCppServiceConfig(getStore()));
  }
  return rt.llamaCppManager;
};

export const getOllamaManager = (): OllamaManager => {
  if (!rt.ollamaManager) {
    rt.ollamaManager = new OllamaManager(() => getOllamaServiceConfig(getStore()));
  }
  return rt.ollamaManager;
};

export const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!rt.appUpdateCoordinator) {
    rt.appUpdateCoordinator = new AppUpdateCoordinator(getStore(), undefined, undefined, {
      enterpriseBuild: isEnterprise,
    });
  }
  return rt.appUpdateCoordinator;
};

export const checkForAppUpdate = (): void => {
  void getAppUpdateCoordinator()
    .checkNow()
    .then(result => {
      if (result.success) rt.lastSuccessfulAppUpdateCheckAt = Date.now();
    });
};

export const startAppUpdatePolling = (): void => {
  // Enterprise builds receive updates through the enterprise distribution
  // channel; the client never runs startup or periodic update checks.
  if (isEnterprise || rt.appUpdatePollTimer) return;
  const startupDelay =
    APP_UPDATE_STARTUP_DELAY_MIN_MS +
    Math.floor(Math.random() * APP_UPDATE_STARTUP_DELAY_JITTER_MS);
  setTimeout(checkForAppUpdate, startupDelay);
  rt.appUpdatePollTimer = setInterval(checkForAppUpdate, APP_UPDATE_POLL_INTERVAL_MS);
};

export const getCoworkStore = () => {
  if (!rt.coworkStore) {
    const sqliteStore = getStore();
    rt.coworkStore = new CoworkStore(sqliteStore.getDatabase());
  }
  return rt.coworkStore;
};

export const getAgentManager = () => {
  if (!rt.agentManager) {
    rt.agentManager = new AgentManager(getCoworkStore());
  }
  return rt.agentManager;
};

export const getSkillManager = () => {
  if (!rt.skillManager) {
    rt.skillManager = new SkillManager(getStore);
  }
  return rt.skillManager;
};

export const getMcpStore = () => {
  if (!rt.mcpStore) {
    const sqliteStore = getStore();
    const nextMcpStore = new McpStore(
      sqliteStore.getDatabase(),
      new McpCredentialVault(sqliteStore),
    );
    nextMcpStore.migrateLegacyCredentials();
    rt.mcpStore = nextMcpStore;
  }
  return rt.mcpStore;
};
