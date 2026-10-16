import type { BrowserWindow } from 'electron';

import type { CanonicalScheduledTaskService } from '../../scheduledTask/canonicalScheduledTaskService';
import type { CcConnectSchedulerRuntime } from '../../scheduledTask/ccConnectSchedulerRuntime';
import type { CcConnectCronClient } from '../../scheduledTask/ccConnectCronClient';
import type { DeferredCcConnectCronClient } from '../../scheduledTask/deferredCcConnectCronClient';
import type { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import type { ActivityService } from '../activity/activityService';
import type { AgentManager } from '../agentManager';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import type { ChannelAccountManager } from '../im/channelAccountManager';
import type { CcConnectPiBridge } from '../im/ccConnectPiBridge';
import type { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import type { CcConnectRuntimeStatusRegistry } from '../libs/ccConnectRuntimeStatusRegistry';
import { CcConnectRuntimeStatusRegistry as CcConnectRuntimeStatusRegistryCtor } from '../libs/ccConnectRuntimeStatusRegistry';
import type { CcConnectSidecarManager } from '../libs/ccConnectSidecarManager';
import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import type { LlamaCppManager } from '../libs/llamacppManager';
import type { LlamaCppModelDaemonController } from '../libs/llamacppModelDaemonController';
import type { McpIntegrationRuntime } from '../libs/mcpIntegrationRuntime';
import type { McpToolManifestEntry, McpServerManager } from '../libs/mcpServerManager';
import type { OllamaManager } from '../libs/ollamaManager';
import type { SqliteBackupManager } from '../libs/sqliteBackup/sqliteBackupManager';
import type { MagpieManager } from '../magpie/manager';
import type { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';
import type { EngramManager } from '../memory/engramManager';
import type { ProjectMemoryService } from '../memory/projectMemoryService';
import type { MemoryRepository } from '../memory/repository';
import type { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { McpStore } from '../mcpStore';
import type { CoworkStore } from '../coworkStore';
import type { SkillManager } from '../skillManager';
import type { SqliteStore } from '../sqliteStore';
import type { TodoReminderScheduler } from '../todo/reminderScheduler';
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
  piRuntimeAdapter: null as PiRuntimeAdapter | null,
  workbenchTaskService: null as WorkbenchTaskService | null,
  codingRoomService: null as CodingRoomService | null,
  engramManager: null as EngramManager | null,
  engramAdapter: null as ZhiYuanEngramAdapter | null,
  memoryRepository: null as MemoryRepository | null,
  projectMemoryService: null as ProjectMemoryService | null,
  todoReminderScheduler: null as TodoReminderScheduler | null,

  skillManager: null as SkillManager | null,
  mcpStore: null as McpStore | null,
  mcpServerManager: null as McpServerManager | null,
  mcpInitPromise: null as Promise<McpToolManifestEntry[]> | null,
  mcpLifecycleGeneration: 0,
  activeMcpAuthorizations: new Map<string, AbortController>(),
  mcpIntegrationRuntime: null as McpIntegrationRuntime | null,
  mcpBridgeRefreshPromise: null as Promise<{ tools: number; error?: string }> | null,
  mcpBridgeRefreshPending: false,

  imGatewayManager: null as ChannelAccountManager | null,
  ccConnectBridgeServer: null as CcConnectBridgeServer | null,
  ccConnectSidecarManager: null as CcConnectSidecarManager | null,
  ccConnectRuntimeStatuses:
    new CcConnectRuntimeStatusRegistryCtor() as CcConnectRuntimeStatusRegistry,
  ccConnectDeliveryAccounts: new Set<string>(),
  ccConnectRuntimeRestartTimer: null as NodeJS.Timeout | null,
  ccConnectRuntimeStopping: false,
  ccConnectRuntimeReconcileQueue: Promise.resolve() as Promise<void>,
  ccConnectRuntimeConfigSignature: '',
  ccConnectRuntimeControlClient: null as CcConnectCronClient | null,
  ccConnectPiBridge: null as CcConnectPiBridge | null,
  canonicalScheduledTaskService: null as CanonicalScheduledTaskService | null,
  activityService: null as ActivityService | null,
  canonicalSchedulerRuntime: null as CcConnectSchedulerRuntime | null,
  deferredCcConnectCronClient: null as DeferredCcConnectCronClient | null,
  ccConnectDeliveryTransport: null as CcConnectDeliveryTransport | null,
  ccConnectBridgeToken: null as string | null,
  ccConnectBridgeUrl: null as string | null,
  ccConnectRuntimeRestartAttempts: 0,

  storeInitPromise: null as Promise<SqliteStore> | null,
  sqliteBackupManager: null as SqliteBackupManager | null,

  llamaCppManager: null as LlamaCppManager | null,
  llamaCppModelDaemonController: null as LlamaCppModelDaemonController | null,
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
