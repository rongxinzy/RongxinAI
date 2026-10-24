import { app, powerSaveBlocker } from 'electron';

import { isEnterprise } from './appEnv';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import { agentRuntime } from './agentRuntimeState';
import { storageRuntime } from './storageRuntimeState';
import { inferenceRuntime } from './inferenceRuntimeState';
import { mcpRuntime } from './mcpRuntimeState';
import {
  APP_UPDATE_POLL_INTERVAL_MS,
  APP_UPDATE_STARTUP_DELAY_JITTER_MS,
  APP_UPDATE_STARTUP_DELAY_MIN_MS,
} from '../../shared/appUpdate/constants';
import { getLlamaCppServiceConfig } from '../ipcHandlers/llamacpp';
import { getOllamaServiceConfig } from '../ipcHandlers/ollama';
import { getStrataServiceConfig } from '../ipcHandlers/strata';
import { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import { LlamaCppManager } from '../libs/llamacppManager';
import { OllamaManager } from '../libs/ollamaManager';
import { StrataManager } from '../libs/strata/strataManager';
import { McpCredentialVault } from '../libs/mcpCredentialVault';
import { McpStore } from '../mcpStore';
import { AgentManager } from '../agentManager';
import { CoworkStore } from '../coworkStore';
import { ArtifactLedger } from '../artifactLedger/artifactLedger';
import { SkillManager } from '../skillManager';
import { ActivityService } from '../activity/activityService';
import { SqliteStore } from '../sqliteStore';
import { channelRuntime } from './channelRuntimeState';

const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;

export function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (
      lifecycleRuntime.preventSleepBlockerId === null ||
      !powerSaveBlocker.isStarted(lifecycleRuntime.preventSleepBlockerId)
    ) {
      lifecycleRuntime.preventSleepBlockerId = powerSaveBlocker.start(
        PowerSaveBlockerType.PreventAppSuspension,
      );
    }
    return;
  }

  if (
    lifecycleRuntime.preventSleepBlockerId !== null &&
    powerSaveBlocker.isStarted(lifecycleRuntime.preventSleepBlockerId)
  ) {
    powerSaveBlocker.stop(lifecycleRuntime.preventSleepBlockerId);
  }
  lifecycleRuntime.preventSleepBlockerId = null;
}

export const initStore = async (): Promise<SqliteStore> => {
  if (!storageRuntime.storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    // better-sqlite3 opens the database synchronously, so Promise.resolve() resolves
    // immediately. The timeout acts as a safety net for unexpected OS-level
    // blocking during store initialization and recovery.
    storageRuntime.storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000),
      ),
    ]);
  }
  return storageRuntime.storeInitPromise;
};

export const getStore = (): SqliteStore => {
  if (!storageRuntime.store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storageRuntime.store;
};

export const getLlamaCppManager = (): LlamaCppManager => {
  if (!inferenceRuntime.llamaCppManager) {
    inferenceRuntime.llamaCppManager = new LlamaCppManager(() =>
      getLlamaCppServiceConfig(getStore()),
    );
  }
  return inferenceRuntime.llamaCppManager;
};

export const getOllamaManager = (): OllamaManager => {
  if (!inferenceRuntime.ollamaManager) {
    inferenceRuntime.ollamaManager = new OllamaManager(() => getOllamaServiceConfig(getStore()));
  }
  return inferenceRuntime.ollamaManager;
};

export const getStrataManager = (): StrataManager => {
  if (!inferenceRuntime.strataManager) {
    inferenceRuntime.strataManager = new StrataManager(
      () => getStrataServiceConfig(getStore()),
      () => inferenceRuntime.llamaCppModelOrchestrator,
    );
  }
  return inferenceRuntime.strataManager;
};

export const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!lifecycleRuntime.appUpdateCoordinator) {
    lifecycleRuntime.appUpdateCoordinator = new AppUpdateCoordinator(
      getStore(),
      undefined,
      undefined,
      {
        enterpriseBuild: isEnterprise,
      },
    );
  }
  return lifecycleRuntime.appUpdateCoordinator;
};

export const checkForAppUpdate = (): void => {
  void getAppUpdateCoordinator()
    .checkNow()
    .then(result => {
      if (result.success) lifecycleRuntime.lastSuccessfulAppUpdateCheckAt = Date.now();
    });
};

export const startAppUpdatePolling = (): void => {
  // Enterprise builds receive updates through the enterprise distribution
  // channel; the client never runs startup or periodic update checks.
  if (isEnterprise || lifecycleRuntime.appUpdatePollTimer) return;
  const startupDelay =
    APP_UPDATE_STARTUP_DELAY_MIN_MS +
    Math.floor(Math.random() * APP_UPDATE_STARTUP_DELAY_JITTER_MS);
  setTimeout(checkForAppUpdate, startupDelay);
  lifecycleRuntime.appUpdatePollTimer = setInterval(checkForAppUpdate, APP_UPDATE_POLL_INTERVAL_MS);
};

export const getCoworkStore = () => {
  if (!storageRuntime.coworkStore) {
    const sqliteStore = getStore();
    storageRuntime.coworkStore = new CoworkStore(sqliteStore.getDatabase(), getArtifactLedger());
  }
  return storageRuntime.coworkStore;
};

/** Shared artifact ledger over the main SQLite database (event-time source of truth). */
export const getArtifactLedger = (): ArtifactLedger => {
  if (!storageRuntime.artifactLedger) {
    storageRuntime.artifactLedger = new ArtifactLedger(getStore().getDatabase());
  }
  return storageRuntime.artifactLedger;
};

export const getAgentManager = () => {
  if (!agentRuntime.agentManager) {
    agentRuntime.agentManager = new AgentManager(getCoworkStore());
  }
  return agentRuntime.agentManager;
};

export const getSkillManager = () => {
  if (!agentRuntime.skillManager) {
    agentRuntime.skillManager = new SkillManager(getStore);
  }
  return agentRuntime.skillManager;
};

export const getMcpStore = () => {
  if (!mcpRuntime.store) {
    const sqliteStore = getStore();
    const nextMcpStore = new McpStore(
      sqliteStore.getDatabase(),
      new McpCredentialVault(sqliteStore),
    );
    nextMcpStore.migrateLegacyCredentials();
    mcpRuntime.store = nextMcpStore;
  }
  return mcpRuntime.store;
};

/** Lazily constructed shared activity service (single source in runtime state). */
export const getActivityService = (): ActivityService => {
  channelRuntime.activityService ??= new ActivityService(getStore().getDatabase());
  return channelRuntime.activityService;
};
