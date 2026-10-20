import type { BrowserWindow } from 'electron';

import type { AgentManager } from '../agentManager';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import type { LlamaCppManager } from '../libs/llamacppManager';
import type { LlamaCppModelOrchestrator } from '../libs/llamacppModelOrchestrator';
import type { OllamaManager } from '../libs/ollamaManager';
import type { SqliteBackupManager } from '../libs/sqliteBackup/sqliteBackupManager';
import type { MagpieManager } from '../magpie/manager';
import type { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { CoworkStore } from '../coworkStore';
import type { ArtifactLedger } from '../artifactLedger/artifactLedger';
import type { SkillManager } from '../skillManager';
import type { SqliteStore } from '../sqliteStore';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';

/**
 * Mutable singleton state shared across the main-process bootstrap modules.
 * Everything here is initialized lazily by the owning module; the object shape
 * keeps cross-module reads/writes identical to the previous single-closure
 * behavior in main.ts.
 */
export const rt = {
  store: null as SqliteStore | null,
  coworkStore: null as CoworkStore | null,
  artifactLedger: null as ArtifactLedger | null,
  piRuntimeAdapter: null as PiRuntimeAdapter | null,
  workbenchTaskService: null as WorkbenchTaskService | null,
  codingRoomService: null as CodingRoomService | null,

  skillManager: null as SkillManager | null,

  storeInitPromise: null as Promise<SqliteStore> | null,
  sqliteBackupManager: null as SqliteBackupManager | null,

  llamaCppManager: null as LlamaCppManager | null,
  llamaCppModelOrchestrator: null as LlamaCppModelOrchestrator | null,
  ollamaManager: null as OllamaManager | null,

  piWorkbenchRuntimeForwarderBound: false,
  preventSleepBlockerId: null as number | null,
  appUpdateCoordinator: null as AppUpdateCoordinator | null,
  appUpdatePollTimer: null as NodeJS.Timeout | null,
  lastSuccessfulAppUpdateCheckAt: 0,

  agentManager: null as AgentManager | null,

  mainWindow: null as BrowserWindow | null,
  magpieManager: undefined as MagpieManager | undefined,
  managedMagpieBindings: undefined as ManagedMagpieProviderBindings | undefined,
  disposeMagpieModels: undefined as (() => void) | undefined,
  disposeMagpie: undefined as (() => Promise<void>) | undefined,

  isQuitting: false,
  lastReloadAt: 0,
  windowStateSaveTimer: null as ReturnType<typeof setTimeout> | null,
};
