import crypto from 'crypto';
import { spawn } from 'child_process';
import type { WebContents } from 'electron';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
  safeStorage,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import { buildSessionTitleFromInput } from '../common/sessionTitle';
import { classifyCoworkError } from '../common/coworkError';
import {
  migrateLegacyScheduledTaskRunsToCanonical,
  migrateLegacyScheduledTasksToCanonical,
} from '../scheduledTask/migrate';
import { CanonicalScheduledTaskService } from '../scheduledTask/canonicalScheduledTaskService';
import { CcConnectSchedulerRuntime } from '../scheduledTask/ccConnectSchedulerRuntime';
import { CcConnectCronClient, SchedulerClockAccount } from '../scheduledTask/ccConnectCronClient';
import { DeferredCcConnectCronClient } from '../scheduledTask/deferredCcConnectCronClient';
import { CcConnectDeliveryClient } from '../scheduledTask/ccConnectDeliveryClient';
import { CcConnectDeliveryTransport } from '../scheduledTask/ccConnectDeliveryTransport';
import { ScheduledTaskDeliveryDispatcher } from '../scheduledTask/deliveryDispatcher';
import { PiScheduledTaskExecutor } from '../scheduledTask/piScheduledTaskExecutor';
import { SqliteScheduledTaskStore } from '../scheduledTask/sqliteScheduledTaskStore';
import { ActivityService } from './activity/activityService';
import { registerActivityIpcHandlers } from './activity/ipcHandlers';
import { ActivitySource, ActivityStatus } from '../shared/activity/constants';
import { AgentIpcChannel } from '../shared/agent/constants';
import {
  APP_UPDATE_POLL_INTERVAL_MS,
  APP_UPDATE_STARTUP_DELAY_JITTER_MS,
  APP_UPDATE_STARTUP_DELAY_MIN_MS,
  AppUpdateIpc,
} from '../shared/appUpdate/constants';
import {
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkPermissionMode,
  CoworkSessionMode,
  type CoworkSessionSource,
} from '../shared/cowork/constants';
import {
  type CoworkSessionExpertInput,
  type CoworkSessionExpertSnapshot,
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
} from '../shared/cowork/sessionExperts';
import {
  ApiIpc,
  AppIpc,
  CommunityAuthIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
  HardwareIpc,
  ImIpc,
  McpIpc,
  ManagedProviderIpc,
  ProjectIpc,
  SkillsIpc,
  WeixinInstallIpc,
} from '../shared/ipc/channels';
import { EnterpriseSessionIpc } from '../shared/enterpriseSession';
import { EnterpriseRendererIpc } from '../shared/enterpriseRenderer';
import {
  CoworkQueueEnqueueSchema,
  CoworkQueueItemSchema,
  CoworkQueueSessionSchema,
  CoworkQueueUpdateSchema,
} from '../shared/ipc/queueSchemas';
import {
  ApiFetchSchema,
  ApiStreamSchema,
  CoworkSessionContinueSchema,
  CoworkSessionStartSchema,
  CoworkSessionUpdateModelSchema,
  ProjectCreateDirectorySchema,
} from '../shared/ipc/schemas';
import { WorkspaceIpc, WorkspaceStoreKey } from '../shared/workspace';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  type WorkbenchRun,
  type WorkbenchTask,
} from '../shared/workbenchTask';
import { AgentManager } from './agentManager';
import { ConversationHistoryService } from './conversationHistory/service';
import { EngramManager } from './memory/engramManager';
import { LegacyMemoryMigrationService } from './memory/legacyMemoryMigrationService';
import {
  importLegacyMemoryFileCandidates,
  importLegacySqliteMemoryCandidates,
} from './memory/legacyMemoryFileImportService';
import { ProjectMemoryService } from './memory/projectMemoryService';
import { MemoryRepository } from './memory/repository';
import { SessionSummaryService } from './memory/sessionSummaryService';
import { SessionSummaryBackfillService } from './memory/sessionSummaryBackfillService';
import { ZhiYuanEngramAdapter } from './memory/zhiyuanEngramAdapter';
import { registerMemoryIpcHandlers } from './memory/ipc';
import { resolveMemorySessionTitles } from './memory/sessionTitleResolver';
import { promoteVerifiedWorkbenchRun } from './memory/taskMemoryPromotion';
import { searchAnySearchGateway } from './libs/anysearchGateway';
import {
  resolveAnySearchGatewayToken,
  resolveAnySearchGatewayUrl,
} from './libs/anysearchGatewayCredentials';
import { APP_DATA_DIR_NAME, APP_NAME, DB_FILENAME } from './appConstants';
import { AppQuitOrigin, getAppQuitOrigin, recordAppQuitOrigin } from './appQuitOrigin';
import { getAutoLaunchEnabled, isAutoLaunched, setAutoLaunchEnabled } from './autoLaunchManager';
import { getChangedSessionPermissionModes } from './coworkPermissionModeChanges';
import type { CoworkPromptLanguage } from './coworkLanguagePrompt';
import { composeCoworkSystemPrompt } from './coworkPrompt/composer';
import { reconcileWorkSessionRuntimeState } from './coworkSessionRuntimeState';
import { resolveCoworkContinuationSkillState } from './coworkSessionSkills';
import {
  type CoworkExecutionMode,
  type CoworkMessageType,
  type CoworkSessionStatus,
  CoworkStore,
} from './coworkStore';
import {
  getDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from './defaultConversationWorkspace';
import { setLanguage, t } from './i18n';
import { IMGatewayConfig } from './im';
import { ChannelAccountManager } from './im/channelAccountManager';
import { type IMGatewayConfigPatch, sanitizeRendererIMConfigPatch } from './im/configPatch';
import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  FeishuInstanceConfig,
  Platform,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from './im/types';
import { getLlamaCppServiceConfig, registerLlamaCppIpcHandlers } from './ipcHandlers/llamacpp';
import { registerMarketplaceIpcHandlers } from './ipcHandlers/marketplace';
import { getOllamaServiceConfig, registerOllamaIpcHandlers } from './ipcHandlers/ollama';
import { registerProviderModelDiscoveryIpcHandler } from './ipcHandlers/providerModelDiscovery';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from './ipcHandlers/scheduledTask';
import { registerTriageIpcHandlers } from './ipcHandlers/triage';
import { registerCodingAgentIpcHandlers } from './ipcHandlers/codingAgent';
import { CodingRoomRepository } from './codingAgent/codingRoomRepository';
import { CodingRoomService } from './codingAgent/codingRoomService';
import { resolveAcpAdapterRoot } from './codingAgent/acp/adapterRoot';
import { CodingAgentRegistry } from './codingAgent/codingAgentRegistry';
import { CodingAgentProfileRepository } from './codingAgent/codingAgentProfileRepository';
import { GitWorktreeService } from './codingAgent/gitWorktreeService';
import { CodingEventKind, CodingStreamUpdateMode } from '../shared/codingAgent';
import type { CoworkToolActivityEvent } from '../shared/cowork/toolActivity';
import { CoworkInterruptionCause } from '../shared/cowork/interruption';
import { normalizePiMessage, normalizePiToolActivity } from './codingAgent/piCodingEventAdapter';
import { registerWorkbenchTaskIpcHandlers } from './workbenchTask/ipc';
import { WorkbenchTaskService } from './workbenchTask/taskService';
import { registerTodoIpcHandlers } from './todo/ipc';
import { TodoReminderScheduler } from './todo/reminderScheduler';
import { shouldRequireProductionOnResume } from './productionLoop/entryPolicy';
import { type PermissionResult, PiRuntimeAdapter } from './libs/agentEngine';
import type { PiThinkingLevel } from './libs/agentEngine/piRuntimeTypes';
import { PiModelCatalogRefreshCoordinator } from './libs/agentEngine/piModelCatalogRefresh';
import { AppUpdateCoordinator } from './libs/appUpdateCoordinator';
import {
  getCurrentApiConfig,
  resolveAllEnabledProviderConfigs,
  resolveAllProviderApiKeys,
  resolveCurrentApiConfig,
  resolveRawApiConfig,
  setStoreGetter,
} from './libs/claudeSettings';
import {
  clearCopilotTokenState,
  initCopilotTokenManager,
  refreshCopilotTokenNow,
  setCopilotTokenState,
} from './libs/copilotTokenManager';
import { saveCoworkApiConfig } from './libs/coworkConfigStore';
import { getCoworkLogPath } from './libs/coworkLogger';
import {
  registerProxyTokenRefresher,
  startCoworkOpenAICompatProxy,
  stopCoworkOpenAICompatProxy,
} from './libs/coworkOpenAICompatProxy';
import {
  applyApplicationRuntimeEnv,
  generateSessionTitle,
  getSkillsRoot,
  probeCoworkModelReadiness,
} from './libs/coworkUtil';
import { resolveBundledNpmRuntime, NpmCli } from './libs/npmRuntime';
import { createContentSecurityPolicy } from './contentSecurityPolicy';
import { refreshEndpointsTestMode } from './libs/endpoints';
import { resolveEnterpriseConfigPath, syncEnterpriseConfig } from './libs/enterpriseConfigSync';
import {
  disposeZhiyuanEnterpriseExtension,
  initializeZhiyuanEnterpriseExtension,
} from './enterpriseExtension/host';
import {
  ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
  zhiyuanEnterpriseRendererBridge,
} from './enterpriseExtension/rendererBridge';
import {
  allowEnterpriseRendererOpaqueOrigin,
  ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
} from './enterpriseExtension/rendererProtocol';
import { zhiyuanEnterpriseSessionBridge } from './enterpriseExtension/sessionBridge';
import { zhiyuanManagedProviderBridge } from './enterpriseExtension/managedProviderBridge';
import { ZhiyuanEnterpriseSkillBridge } from './enterpriseExtension/skillBridge';
import { LlamaCppManager } from './libs/llamacppManager';
import { CcConnectBridgeServer } from './libs/ccConnectBridgeServer';
import { serializeCcConnectSidecarConfig } from './libs/ccConnectSidecarConfig';
import { listCcConnectAccountConfigs } from './libs/ccConnectAccountConfig';
import { resolveCcConnectAccountRuntimeStatus } from './libs/ccConnectAccountRuntimeStatus';
import { CcConnectRuntimeStatusRegistry } from './libs/ccConnectRuntimeStatusRegistry';
import { CcConnectSidecarManager } from './libs/ccConnectSidecarManager';
import { runCcConnectWeixinSetup } from './libs/ccConnectWeixinSetup';
import { MCP_OAUTH_STORE_PREFIX, McpOAuthManager } from './libs/mcpOAuthManager';
import { generateCorrelationId, runWithCorrelationId } from './libs/logCorrelation';
import { exportLogsZip } from './libs/logExport';
import {
  validateMcpServerConfig,
  validateStoredMcpServerConfig,
} from './libs/mcpCommandValidation';
import { probeMcpConnection } from './libs/mcpConnectionProbe';
import type { McpToolManifestEntry } from './libs/mcpServerManager';
import { McpServerManager } from './libs/mcpServerManager';
import { loadBundledMcpMarketplace } from './mcpMarketplace';
import {
  fetchModelScopeSkillContent,
  fetchModelScopeSkillMarketplace,
} from './libs/modelscopeSkillMarketplace';
import { createModelScopeTokenPool, ModelScopeStoreKey } from './libs/modelscopeTokenPool';
import { getNvidiaSmiSnapshot } from './libs/nvidiaSmi';
import { getSystemMemorySnapshot } from './libs/systemMemory';
import { OllamaManager } from './libs/ollamaManager';
import { resolveQualifiedAgentModelRef } from './libs/agentModels';
import { consumePendingLocalInferenceInstall } from './libs/pendingLocalInferenceInstall';
import { readBootstrapFile, writeBootstrapFile } from './libs/agentMemoryFile';
import { appendPythonRuntimeToEnv, ensurePythonRuntimeReady } from './libs/pythonRuntime';
import { serializeForLog } from './libs/sanitizeForLog';
import { SqliteBackupManager } from './libs/sqliteBackup/sqliteBackupManager';
import { createLogger } from './libs/structuredLog';
import {
  applySystemProxyEnv,
  resolveSystemProxyUrlForTargets,
  restoreOriginalProxyEnv,
  setSystemProxyEnabled,
} from './libs/systemProxy';
import { getLogFilePath, getRecentMainLogEntries, initLogger } from './logger';
import type { McpServerFormData } from './mcpStore';
import { McpStore } from './mcpStore';
import { parseCcConnectScopedConversationId } from './im/ccConnectConversationId';
import { CcConnectPiBridge } from './im/ccConnectPiBridge';
import { ChannelInboxStore } from './im/channelInboxStore';
import { ChannelTurnCoordinator } from './im/channelTurnCoordinator';
import { createIMScheduledTaskRequestDetector } from './im/imScheduledTaskHandler';
import { IMStore } from './im/imStore';
import { shouldReloadRendererProcess } from './rendererProcessRecovery';
import { configureRendererStartup } from './rendererStartup';
import { SkillManager } from './skillManager';
import { listPresetExperts } from './presetExpertCatalog';
import { resolveBundledPresetExpertSnapshot } from './presetExpertSnapshot';
import { getSkillServiceManager } from './skillServices';
import { SqliteStore } from './sqliteStore';
import { StartupProfiler } from './startupProfiler';
import { createTray, destroyTray, updateTrayMenu } from './trayManager';
import {
  AppWindowStoreKey,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  resolveInitialAppWindowState,
  type WindowRectangle,
} from './windowState';

// 设置应用程序名称
app.name = APP_NAME;
app.setName(APP_NAME);

protocol.registerSchemesAsPrivileged([
  {
    scheme: ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
    privileges: ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
  },
]);

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_UPDATE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const resolveDefaultAgentModelRef = (): string => {
  const apiResolution = resolveRawApiConfig();
  const config = apiResolution.config;
  const providerName = apiResolution.providerMetadata?.providerName.trim();
  const modelId = config?.model?.trim();
  if (!providerName || !modelId) {
    return '';
  }
  return `${providerName}/${modelId}`;
};

const migrateAgentModelRefs = (): number => {
  const defaultModelRef = resolveDefaultAgentModelRef();
  if (!defaultModelRef) return 0;

  const availableProviders = buildAvailableAgentProviders();
  const agents = getAgentManager().listAgents();
  let changed = 0;

  for (const agent of agents) {
    const normalizedModel = agent.model.trim();
    if (!normalizedModel) continue;

    const qualification = resolveQualifiedAgentModelRef({
      agentModel: normalizedModel,
      availableProviders,
    });

    if (qualification.status === 'ambiguous') {
      console.warn(
        `[Main] Skipped ambiguous agent model migration for "${agent.id}" because "${qualification.modelId}" matches multiple providers: ${qualification.providerIds.join(', ')}`,
      );
      continue;
    }

    if (qualification.status !== 'qualified' || qualification.primaryModel === agent.model.trim()) {
      continue;
    }

    getCoworkStore().updateAgent(agent.id, { model: qualification.primaryModel });
    changed += 1;
  }

  return changed;
};

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

const resolveInlineAttachmentDir = (cwd?: string): string => {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, '.cowork-temp', 'attachments', 'manual');
    }
  }
  return path.join(app.getPath('temp'), 'zhiyuan', 'attachments');
};

const ensurePngFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.png') ? value : `${value}.png`;
};

const ensureZipFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.zip') ? value : `${value}.zip`;
};

const padTwoDigits = (value: number): string => value.toString().padStart(2, '0');

const buildLogExportFileName = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${padTwoDigits(now.getMonth() + 1)}${padTwoDigits(now.getDate())}`;
  const timePart = `${padTwoDigits(now.getHours())}${padTwoDigits(now.getMinutes())}${padTwoDigits(now.getSeconds())}`;
  return `zhiyuan-logs-${datePart}-${timePart}.zip`;
};

const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated in main IPC forwarding]`;
};

const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, IPC_MAX_ITEMS)
      .map(entry => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[truncated-items:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[circular]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

const sanitizeCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as { metadata?: unknown; content?: unknown };

  // Preserve imageAttachments in metadata as-is (base64 data can be very large
  // and must not be truncated by the generic sanitizer).
  let sanitizedMetadata: unknown;
  if (messageRecord.metadata && typeof messageRecord.metadata === 'object') {
    const { imageAttachments, fileAttachments, ...rest } = messageRecord.metadata as Record<
      string,
      unknown
    >;
    const sanitizedRest = sanitizeIpcPayload(rest) as Record<string, unknown> | undefined;
    sanitizedMetadata = {
      ...(sanitizedRest && typeof sanitizedRest === 'object' ? sanitizedRest : {}),
      ...(Array.isArray(imageAttachments) && imageAttachments.length > 0
        ? { imageAttachments }
        : {}),
      ...(Array.isArray(fileAttachments) && fileAttachments.length > 0
        ? {
            fileAttachments: fileAttachments
              .filter(
                (attachment): attachment is Record<string, unknown> =>
                  Boolean(attachment) && typeof attachment === 'object',
              )
              .slice(0, IPC_MAX_ITEMS)
              .map(attachment => ({
                name: typeof attachment.name === 'string' ? attachment.name : '',
                path: typeof attachment.path === 'string' ? attachment.path : '',
                extension: typeof attachment.extension === 'string' ? attachment.extension : '',
                ...(typeof attachment.isImage === 'boolean' ? { isImage: attachment.isImage } : {}),
              })),
          }
        : {}),
    };
  } else {
    sanitizedMetadata = undefined;
  }

  return {
    ...message,
    content:
      typeof messageRecord.content === 'string'
        ? truncateIpcString(messageRecord.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
        : '',
    metadata: sanitizedMetadata,
  };
};

const sanitizePermissionRequestForIpc = (request: unknown): unknown => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  const requestRecord = request as { toolInput?: unknown };
  return {
    ...request,
    toolInput: sanitizeIpcPayload(requestRecord.toolInput ?? {}),
  };
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const normalizeCaptureRect = (rect?: Partial<CaptureRect> | null): CaptureRect | null => {
  if (!rect) return null;
  const normalized = {
    x: Math.max(0, Math.round(typeof rect.x === 'number' ? rect.x : 0)),
    y: Math.max(0, Math.round(typeof rect.y === 'number' ? rect.y : 0)),
    width: Math.max(0, Math.round(typeof rect.width === 'number' ? rect.width : 0)),
    height: Math.max(0, Math.round(typeof rect.height === 'number' ? rect.height : 0)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
};

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  // Reject bare Windows drive roots (e.g. "D:\") — mkdir on drive roots causes EPERM,
  // and tool runtimes may fail when given a drive root as workspace.
  if (process.platform === 'win32' && /^[a-zA-Z]:\\?$/.test(resolvedWorkspaceRoot)) {
    throw new Error(
      `Cannot use a drive root as the working directory (${resolvedWorkspaceRoot}). Please select a subfolder instead, for example: ${resolvedWorkspaceRoot}Projects`,
    );
  }
  if (!fs.existsSync(resolvedWorkspaceRoot)) {
    fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  }
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const getDefaultExportImageName = (defaultFileName?: string): string => {
  const normalized =
    typeof defaultFileName === 'string' && defaultFileName.trim()
      ? defaultFileName.trim()
      : `cowork-session-${Date.now()}`;
  return ensurePngFileName(sanitizeExportFileName(normalized));
};

const savePngWithDialog = async (
  webContents: WebContents,
  pngData: Buffer,
  defaultFileName?: string,
): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> => {
  const defaultName = getDefaultExportImageName(defaultFileName);
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const saveOptions = {
    title: 'Export Session Image',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  };
  const saveResult = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: true, canceled: true };
  }

  const outputPath = ensurePngFileName(saveResult.filePath);
  await fs.promises.writeFile(outputPath, pngData);
  return { success: true, canceled: false, path: outputPath };
};

const configureUserDataPath = (): void => {
  const memoryLeakTestUserDataPath = process.env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA;
  if (memoryLeakTestUserDataPath) {
    app.setPath('userData', memoryLeakTestUserDataPath);
    return;
  }

  const appDataPath = app.getPath('appData');
  const targetUserDataPath = path.join(appDataPath, APP_DATA_DIR_NAME);
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== targetUserDataPath) {
    app.setPath('userData', targetUserDataPath);
    console.log(`[Main] userData path updated: ${currentUserDataPath} -> ${targetUserDataPath}`);
  }
};

configureUserDataPath();
initLogger();

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
// The packaged Ubuntu smoke test needs an actual painted window. Production
// startup stays hidden until ready-to-show to avoid a flash of empty content.
const isLinuxRendererSmoke = isLinux && process.argv.includes('--zhiyuan-linux-renderer-smoke');
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' || process.env.ELECTRON_ENABLE_LOGGING === 'true';
const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // Align light title bar with app light surface-muted tone to reduce visual contrast.
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeWindowsShellPath = (inputPath: string): string => {
  if (!isWindows) return inputPath;

  const trimmed = inputPath.trim();
  if (!trimmed) return inputPath;

  let normalized = trimmed;
  if (/^file:\/\//i.test(normalized)) {
    normalized = safeDecodeURIComponent(normalized.replace(/^file:\/\//i, ''));
  }

  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  const unixDriveMatch = normalized.match(/^[/\\]([A-Za-z])[/\\](.+)$/);
  if (unixDriveMatch) {
    const drive = unixDriveMatch[1].toUpperCase();
    const rest = unixDriveMatch[2].replace(/[/\\]+/g, '\\');
    return `${drive}:\\${rest}`;
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    const drive = normalized[0].toUpperCase();
    const rest = normalized.slice(1).replace(/\//g, '\\');
    return `${drive}${rest}`;
  }

  return normalized;
};

// ==================== macOS Permissions ====================

/**
 * Check calendar permission on macOS by attempting to access Calendar app
 * Returns: 'authorized' | 'denied' | 'restricted' | 'not-determined'
 * On Windows, checks if Outlook is available
 * On Linux, returns 'not-supported'
 */
const checkCalendarPermission = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    try {
      // Try to access Calendar to check permission
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Quick test to see if we can access Calendar
      await execAsync('osascript -l JavaScript -e \'Application("Calendar").name()\'', {
        timeout: 5000,
      });
      console.log('[Permissions] macOS Calendar access: authorized');
      return 'authorized';
    } catch (error: unknown) {
      const stderr =
        typeof error === 'object' && error && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : '';
      // Check if it's a permission error
      if (
        stderr.includes('不能获取对象') ||
        stderr.includes('not authorized') ||
        stderr.includes('Permission denied')
      ) {
        console.log('[Permissions] macOS Calendar access: not-determined (needs permission)');
        return 'not-determined';
      }
      console.warn('[Permissions] Failed to check macOS calendar permission:', error);
      return 'not-determined';
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a system-level calendar permission like macOS
    // Instead, we check if Outlook is available
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Check if Outlook COM object is accessible
      const checkScript = `
        try {
          $Outlook = New-Object -ComObject Outlook.Application
          $Outlook.Version
        } catch { exit 1 }
      `;
      await execAsync('powershell -Command "' + checkScript + '"', {
        timeout: 10000,
        windowsHide: true,
      });
      console.log('[Permissions] Windows Outlook is available');
      return 'authorized';
    } catch {
      console.log('[Permissions] Windows Outlook not available or not accessible');
      return 'not-determined';
    }
  }

  return 'not-supported';
};

/**
 * Request calendar permission on macOS
 * On Windows, attempts to initialize Outlook COM object
 */
const requestCalendarPermission = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // On macOS, we trigger permission by trying to access Calendar
      // The system will show permission dialog if needed
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      await execAsync(
        'osascript -l JavaScript -e \'Application("Calendar").calendars()[0].name()\'',
        { timeout: 10000 },
      );
      return true;
    } catch (error) {
      console.warn('[Permissions] Failed to request macOS calendar permission:', error);
      return false;
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a permission dialog for COM objects
    // We just check if Outlook is available
    const status = await checkCalendarPermission();
    return status === 'authorized';
  }

  return false;
};

// Configure Chromium switches before app readiness. Linux defaults to software rendering to avoid
// blank windows on incompatible Ubuntu GPU/Wayland combinations. This does not affect llama.cpp.
const rendererStartup = configureRendererStartup({
  platform: process.platform,
  env: process.env,
  commandLine: app.commandLine,
  disableHardwareAcceleration: () => app.disableHardwareAcceleration(),
});
if (isLinux && rendererStartup.softwareRenderingEnabled) {
  console.log(
    '[RendererStartup] software rendering is enabled; set ZHIYUAN_ENABLE_GPU=1 to opt in to GPU acceleration',
  );
}
if (enableVerboseLogging) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// 配置网络服务
app.on('ready', () => {
  // 配置网络服务重启策略
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'off',
  });
});

// 添加错误处理
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('[RendererProcess] Render process exited:', details);
  if (shouldReloadRendererProcess(details.reason, isQuitting)) {
    scheduleReload(`render-process-gone (${details.reason})`, webContents);
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('Child process gone:', details);
  if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
    scheduleReload(`child-process-gone (${details.type}/${details.reason})`);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection:', error);
});

process.on('exit', code => {
  console.log(`[Main] Process exiting with code: ${code}`);
});

let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let piRuntimeAdapter: PiRuntimeAdapter | null = null;
let piModelCatalogRefreshCoordinator: PiModelCatalogRefreshCoordinator | null = null;
let workbenchTaskService: WorkbenchTaskService | null = null;
let codingRoomService: CodingRoomService | null = null;
let engramManager: EngramManager | null = null;
let engramAdapter: ZhiYuanEngramAdapter | null = null;
let memoryRepository: MemoryRepository | null = null;
let projectMemoryService: ProjectMemoryService | null = null;
let todoReminderScheduler: TodoReminderScheduler | null = null;

const getWorkbenchTaskService = (): WorkbenchTaskService => {
  if (!workbenchTaskService) {
    workbenchTaskService = new WorkbenchTaskService(getStore().getDatabase(), {
      onVerifiedRun: event => {
        const complete = getPiRuntimeAdapter().getSessionMemoryCompletion(event.task.sessionId);
        if (!complete) {
          console.warn(
            '[Memory] Skipped verified run extraction because the session model is unavailable.',
          );
          return;
        }
        void promoteVerifiedWorkbenchRun(getProjectMemoryService(), event, complete).catch(
          error => {
            console.warn('[Memory] Failed to extract verified run memory:', error);
          },
        );
      },
    });
  }
  return workbenchTaskService;
};

const getCodingRoomService = (): CodingRoomService => {
  if (!codingRoomService) {
    const runtime = getPiRuntimeAdapter();
    codingRoomService = new CodingRoomService(
      new CodingRoomRepository(getStore().getDatabase()),
      new CodingAgentRegistry(
        new CodingAgentProfileRepository(getStore().getDatabase()),
        () => resolveCurrentApiConfig().config !== null,
        app.isPackaged
          ? path.join(process.resourcesPath, 'acp', 'registry.json')
          : path.join(process.cwd(), 'resources', 'acp', 'registry.json'),
        resolveAcpAdapterRoot({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        }),
      ),
      {
        startBuiltinSession: async ({
          sessionId,
          workspaceRoot,
          prompt,
          modelOverride,
          thinkingLevel,
          permissionMode,
        }) => {
          const approvalMode =
            permissionMode === WorkbenchApprovalMode.Auto ||
            permissionMode === WorkbenchApprovalMode.AllowAll
              ? permissionMode
              : WorkbenchApprovalMode.Ask;
          const coworkStoreInstance = getCoworkStore();
          if (!coworkStoreInstance.getSession(sessionId)) {
            coworkStoreInstance.createSession(
              t('coworkDefaultSessionTitle'),
              workspaceRoot,
              '',
              'local',
              [],
              'main',
              '',
              'work',
              sessionId,
            );
          }
          coworkStoreInstance.updateSession(sessionId, { status: 'running' });
          await runtime.startSession(sessionId, prompt, {
            skipInitialUserMessage: true,
            workspaceRoot,
            sessionMode: 'work',
            confirmationMode: 'modal',
            approvalMode,
            ...(modelOverride ? { modelOverride } : {}),
            ...(thinkingLevel ? { thinkingLevel: thinkingLevel as PiThinkingLevel } : {}),
          });
        },
        setBuiltinApprovalMode: (sessionId, mode) =>
          runtime.setApprovalModeForSession(sessionId, mode),
        patchBuiltinSession: (sessionId, patch) =>
          runtime.patchSession(sessionId, {
            model: patch.model,
            thinkingLevel: patch.thinkingLevel as PiThinkingLevel | null | undefined,
          }),
        cancelBuiltinSession: async sessionId => runtime.stopSession(sessionId),
        enqueueBuiltinMessage: (sessionId, prompt) =>
          runtime.enqueuePendingMessage(sessionId, prompt),
        steerBuiltinMessage: async (sessionId, prompt) => {
          const queued = runtime.enqueuePendingMessage(sessionId, prompt);
          if (!queued.success || !queued.item) return queued;
          return await runtime.steerPendingMessage(sessionId, queued.item.id);
        },
        getBuiltinWorkbenchLink: sessionId => {
          const detail = getWorkbenchTaskService().getCurrent(sessionId);
          const runId = detail?.task.activeRunId;
          return detail && runId ? { taskId: detail.task.id, runId } : null;
        },
        beginExternalWorkbenchRun: ({ sessionId, goal, workspaceRoot }) => {
          const workbench = getWorkbenchTaskService().beginRun({
            sessionId,
            goal,
            contract: {
              kind: WorkbenchContractKind.GenericWork,
              requiresUserAcceptance: true,
              metadata: { codingAgent: true, workspaceRoot },
            },
            trigger: WorkbenchRunTrigger.Message,
          });
          getWorkbenchTaskService().updateRunContext(workbench.run.id, {
            model: 'external-agent',
            provider: 'external-agent',
            reasoningProfile: 'external',
            workspaceRoot,
            skillIds: [],
          });
          return { taskId: workbench.task.id, runId: workbench.run.id };
        },
        completeExternalWorkbenchRun: ({ sessionId, runId, workspaceRoot, finalAnswer }) => {
          getWorkbenchTaskService().completeRun({ sessionId, runId, workspaceRoot, finalAnswer });
        },
        failExternalWorkbenchRun: ({ sessionId, error }) => {
          getWorkbenchTaskService().failRun(sessionId, { message: error });
        },
        cancelExternalWorkbenchRun: ({ sessionId, runId }) => {
          getWorkbenchTaskService().cancelRun(sessionId, runId);
        },
        respondBuiltinPermission: (requestId, approved) =>
          runtime.respondToPermission(
            requestId,
            approved
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'The user denied this coding permission.' },
          ),
        validateBuiltinModel: async () => {
          const probe = await probeCoworkModelReadiness();
          if (probe.ok === false) throw new Error(probe.error);
        },
        createIsolatedWorkspace: async ({ workspaceRoot, laneId, baseline }) => {
          const service = new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          );
          return await service.create({ repositoryRoot: workspaceRoot, laneId, baseline });
        },
        getWorkspaceBaseline: async workspaceRoot => {
          try {
            return await GitWorktreeService.getBaseline(workspaceRoot);
          } catch {
            return null;
          }
        },
        getWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyWorkspacePatch: async ({ workspaceRoot, patch }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyPatch(workspaceRoot, patch),
        getIsolatedWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyIsolatedWorkspaceDiff: async ({ workspaceRoot, isolatedWorkspaceRoot }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyWorktreeDiff({
            repositoryRoot: workspaceRoot,
            worktreeRoot: isolatedWorkspaceRoot,
          }),
      },
      {
        // The bundled Claude ACP adapter writes its own full exception details
        // here. This is intentionally app-owned and never includes credentials.
        CLAUDE_AGENT_LOGS: path.join(app.getPath('userData'), 'acp-logs', 'claude'),
        CLAUDE_CODE_DIAGNOSTICS_FILE: path.join(
          app.getPath('userData'),
          'acp-logs',
          'claude',
          'sdk-diagnostics.jsonl',
        ),
      },
    );
    codingRoomService.registry.hydrate();
    runtime.on('message', (sessionId: string, message: unknown) => {
      const metadata =
        message && typeof message === 'object' && 'metadata' in message
          ? (message as { metadata?: unknown }).metadata
          : null;
      const isThinking =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? (metadata as { isThinking?: unknown }).isThinking === true
          : false;
      if (isThinking) {
        codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.Reasoning, {
          message,
          streamUpdateMode: CodingStreamUpdateMode.Replace,
        });
        return;
      }
      const normalized = normalizePiMessage(message);
      if (normalized)
        codingRoomService?.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
    });
    runtime.on(
      'messageUpdate',
      (
        sessionId: string,
        messageId: string,
        content: string,
        metadata?: Record<string, unknown>,
      ) => {
        const isThinking = metadata?.isThinking === true;
        codingRoomService?.recordBuiltinEvent(
          sessionId,
          isThinking ? CodingEventKind.Reasoning : CodingEventKind.MessageDelta,
          {
            content,
            messageId,
            streamUpdateMode: CodingStreamUpdateMode.Replace,
          },
        );
      },
    );
    runtime.on('toolActivity', (sessionId: string, event: CoworkToolActivityEvent) => {
      const normalized = normalizePiToolActivity(event);
      if (normalized)
        codingRoomService?.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
    });
    runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
      const requestId =
        request &&
        typeof request === 'object' &&
        typeof (request as { requestId?: unknown }).requestId === 'string'
          ? (request as { requestId: string }).requestId
          : null;
      codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.Permission, {
        requestId,
        request,
      });
    });
    runtime.on('complete', (sessionId: string) => {
      codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.TurnComplete, {});
    });
    runtime.on('error', (sessionId: string, error: unknown) => {
      codingRoomService?.recordBuiltinEvent(sessionId, CodingEventKind.TurnFailed, { error });
    });
    runtime.on('sessionInterrupted', interruption => {
      if (interruption.cause !== CoworkInterruptionCause.UserStop) {
        codingRoomService?.recordBuiltinInterruption(interruption);
      }
    });
  }
  return codingRoomService;
};

const getEngramManager = (): EngramManager => {
  if (!engramManager) {
    engramManager = new EngramManager({
      userDataPath: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      projectRoot: app.isPackaged ? undefined : process.cwd(),
    });
  }
  return engramManager;
};

const getProjectMemoryService = (): ProjectMemoryService => {
  if (!engramAdapter) engramAdapter = new ZhiYuanEngramAdapter(getEngramManager());
  if (!memoryRepository) memoryRepository = new MemoryRepository(getStore().getDatabase());
  if (!projectMemoryService) {
    projectMemoryService = new ProjectMemoryService(
      memoryRepository,
      engramAdapter,
      undefined,
      path.join(app.getPath('userData'), 'memory'),
    );
  }
  return projectMemoryService;
};

const getPiRuntimeAdapter = (): PiRuntimeAdapter => {
  if (!piRuntimeAdapter) {
    // Pi shell tools inherit the main-process environment. Keep the gateway
    // credential here so installed builds work without user configuration.
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN = resolveAnySearchGatewayToken();
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_URL = resolveAnySearchGatewayUrl();
    // Pi SDK resolves API keys from environment variables (ANTHROPIC_API_KEY etc.).
    // Inject keys from ZhiYuanAgent's provider configuration before initializing Pi.
    const keys = resolveAllProviderApiKeys();
    const injected: string[] = [];
    for (const [suffix, value] of Object.entries(keys)) {
      const envKey = `${suffix}_API_KEY`;
      if (!process.env[envKey] && value) {
        process.env[envKey] = value;
        injected.push(envKey);
      }
    }
    console.log(
      '[PiRuntime] Injected API keys:',
      injected.length > 0 ? injected.join(', ') : '(none — provider config may be empty)',
    );
    piRuntimeAdapter = new PiRuntimeAdapter();
    piRuntimeAdapter.setCoworkStore(getCoworkStore());
    piRuntimeAdapter.setWorkbenchTaskService(getWorkbenchTaskService());
    piRuntimeAdapter.setProjectMemoryService(getProjectMemoryService());
    piRuntimeAdapter.setSessionSummaryService(
      new SessionSummaryService(getProjectMemoryService(), getCoworkStore()),
    );
    piRuntimeAdapter.setSessionSummaryBackfillService(
      new SessionSummaryBackfillService(getProjectMemoryService(), getCoworkStore()),
    );
    piRuntimeAdapter.setLegacyMemoryMigrationService(
      new LegacyMemoryMigrationService(
        getProjectMemoryService(),
        getCoworkStore(),
        getWorkbenchTaskService(),
      ),
    );
    piRuntimeAdapter.setConversationHistoryService(
      new ConversationHistoryService(getStore().getDatabase()),
    );
    // Live team member definitions must read the same bundled truth as the
    // main-session preset snapshot, not the userData skills copy.
    piRuntimeAdapter.setBundledSkillsRoot(getSkillManager().getBundledSkillsRoot());
    // MCP initialization runs asynchronously, so late injection may still be needed.
    console.log('[PiRuntime] mcpServerManager available at init:', mcpServerManager !== null);
  }
  // Late-injection: mcpServerManager is created async after Pi init.
  // On subsequent calls (e.g. from IPC handlers), it is available and
  // we inject it so Pi sessions can use MCP tools.
  if (mcpServerManager && !piRuntimeAdapter.hasMcpServerManager()) {
    console.log('[PiRuntime] Late-injecting mcpServerManager (was null at init)');
    piRuntimeAdapter.setMcpServerManager(mcpServerManager);
  }
  return piRuntimeAdapter;
};
let skillManager: SkillManager | null = null;
let mcpStore: McpStore | null = null;
let mcpServerManager: McpServerManager | null = null;
let mcpInitPromise: Promise<McpToolManifestEntry[]> | null = null;
let mcpLifecycleGeneration = 0;
const activeMcpAuthorizations = new Map<string, AbortController>();
let imGatewayManager: ChannelAccountManager | null = null;
let ccConnectBridgeServer: CcConnectBridgeServer | null = null;
let ccConnectSidecarManager: CcConnectSidecarManager | null = null;
const ccConnectRuntimeStatuses = new CcConnectRuntimeStatusRegistry();
const ccConnectDeliveryAccounts = new Set<string>();
let ccConnectRuntimeRestartTimer: NodeJS.Timeout | null = null;
let ccConnectRuntimeStopping = false;
let ccConnectRuntimeReconcileQueue: Promise<void> = Promise.resolve();
let ccConnectRuntimeConfigSignature = '';
let ccConnectRuntimeControlClient: CcConnectCronClient | null = null;
let ccConnectPiBridge: CcConnectPiBridge | null = null;
let canonicalScheduledTaskService: CanonicalScheduledTaskService | null = null;
let activityService: ActivityService | null = null;
let canonicalSchedulerRuntime: CcConnectSchedulerRuntime | null = null;
let deferredCcConnectCronClient: DeferredCcConnectCronClient | null = null;
let ccConnectDeliveryTransport: CcConnectDeliveryTransport | null = null;
let ccConnectBridgeToken: string | null = null;
let ccConnectBridgeUrl: string | null = null;
let ccConnectRuntimeRestartAttempts = 0;
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
  if (!ccConnectBridgeToken) throw new Error('cc-connect bridge token is not initialized');
  getCanonicalScheduledTaskService();
  const client = new CcConnectCronClient(baseUrl, ccConnectBridgeToken);
  const health = await client.healthCheck(expectedPid);
  await deferredCcConnectCronClient!.attach(accountId, client);
  // The sidecar intentionally has no durable task state. Rebuild its complete
  // trigger projection from SQLite after every successful control-plane attach.
  await canonicalSchedulerRuntime!.reconcile(await getCanonicalScheduledTaskService().listJobs());
  return health;
};
const getCanonicalScheduledTaskService = (): CanonicalScheduledTaskService => {
  if (!canonicalScheduledTaskService) {
    const taskStore = new SqliteScheduledTaskStore(getStore().getDatabase());
    deferredCcConnectCronClient = new DeferredCcConnectCronClient();
    ccConnectDeliveryTransport = new CcConnectDeliveryTransport(
      new IMStore(getStore().getDatabase()),
      getCoworkStore(),
    );
    const executor = new PiScheduledTaskExecutor(getPiRuntimeAdapter(), getCoworkStore());
    activityService ??= new ActivityService(getStore().getDatabase());
    canonicalSchedulerRuntime = new CcConnectSchedulerRuntime(
      taskStore,
      deferredCcConnectCronClient,
      executor.execute.bind(executor),
      new ScheduledTaskDeliveryDispatcher(taskStore, ccConnectDeliveryTransport),
      activityService,
    );
    canonicalScheduledTaskService = new CanonicalScheduledTaskService(
      taskStore,
      canonicalSchedulerRuntime,
    );
  }
  return canonicalScheduledTaskService;
};
const startCcConnectBridge = async (): Promise<void> => {
  if (ccConnectBridgeServer) return;
  const token = crypto.randomBytes(32).toString('base64url');
  ccConnectBridgeToken = token;
  ccConnectPiBridge = new CcConnectPiBridge({
    runtime: getPiRuntimeAdapter(),
    coworkStore: getCoworkStore(),
    imStore: new IMStore(getStore().getDatabase()),
    turnCoordinator: new ChannelTurnCoordinator(new ChannelInboxStore(getStore().getDatabase())),
    activityService:
      activityService ?? (activityService = new ActivityService(getStore().getDatabase())),
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
      canonicalSchedulerRuntime!.handleTrigger({
        accountId: trigger.accountId,
        taskId: trigger.taskId,
        scheduleVersion: trigger.scheduleVersion,
        scheduledAt: trigger.scheduledAt,
      }),
  });
  ccConnectBridgeServer = new CcConnectBridgeServer(token, {
    onTurn: (request, signal) => ccConnectPiBridge!.runTurn(request, signal),
    onCronTrigger: trigger => ccConnectPiBridge!.runCronTrigger(trigger),
  });
  ccConnectBridgeUrl = await ccConnectBridgeServer.start();
};

const resolveCcConnectSidecarExecutable = (): string | null => {
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
  ccConnectRuntimeStatuses.replace(statuses);
};

const refreshCcConnectPlatformStatuses = async (): Promise<void> => {
  if (!ccConnectRuntimeControlClient || !ccConnectSidecarManager?.running) return;
  const health = await ccConnectRuntimeControlClient.healthCheck(
    ccConnectSidecarManager.pid ?? undefined,
  );
  applyCcConnectPlatformStatuses(health.platforms);
};

const startCcConnectRuntime = async (
  accounts: ReturnType<typeof listCcConnectAccountConfigs>,
  signature: string,
): Promise<void> => {
  if (ccConnectSidecarManager) return;
  if (!ccConnectBridgeToken || !ccConnectBridgeUrl)
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
    if (ccConnectSidecarManager === manager) ccConnectSidecarManager = null;
    deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const account of accounts) {
      ccConnectRuntimeStatuses.delete(account.accountId);
      ccConnectDeliveryTransport?.detach(account.accountId);
      ccConnectDeliveryAccounts.delete(account.accountId);
      ccConnectRuntimeStatuses.markUnavailable(
        account.accountId,
        manager.lastError ?? `Channel runtime exited with code ${code ?? 'unknown'}`,
      );
    }
    console.warn(`[ChannelRuntime] Sidecar exited (code=${code}, signal=${signal})`);
    if (
      ccConnectRuntimeStopping ||
      stopRequested ||
      !ccConnectBridgeServer ||
      ccConnectRuntimeRestartTimer
    )
      return;
    scheduleCcConnectRuntimeRestart();
  });
  ccConnectSidecarManager = manager;
  try {
    await manager.start(
      serializeCcConnectSidecarConfig({
        dataDir: sidecarRoot,
        bridgeUrl: ccConnectBridgeUrl,
        bridgeToken: ccConnectBridgeToken,
        cronControlListen: '127.0.0.1:0',
        projects: [{ accountId: SchedulerClockAccount }, ...accounts],
      }),
    );
    const pid = manager.pid;
    if (!pid) throw new Error('cc-connect runtime has no child PID');
    const baseUrl = await manager.waitForControlUrl();
    const health = await waitForCcConnectCronControl(SchedulerClockAccount, baseUrl, pid);
    ccConnectRuntimeControlClient = new CcConnectCronClient(baseUrl, ccConnectBridgeToken);
    const client = new CcConnectDeliveryClient(baseUrl, ccConnectBridgeToken);
    for (const account of accounts) {
      ccConnectDeliveryTransport?.attach(account.accountId, client);
      ccConnectDeliveryAccounts.add(account.accountId);
    }
    applyCcConnectPlatformStatuses(health.platforms);
    ccConnectRuntimeConfigSignature = signature;
    ccConnectRuntimeRestartAttempts = 0;
    console.log(`[ChannelRuntime] Started one runtime with ${accounts.length} channel account(s)`);
  } catch (error) {
    if (ccConnectSidecarManager === manager) ccConnectSidecarManager = null;
    ccConnectRuntimeControlClient = null;
    deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const account of accounts) {
      ccConnectRuntimeStatuses.delete(account.accountId);
      ccConnectDeliveryTransport?.detach(account.accountId);
      ccConnectDeliveryAccounts.delete(account.accountId);
      ccConnectRuntimeStatuses.markUnavailable(
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
  if (signature === ccConnectRuntimeConfigSignature && ccConnectSidecarManager?.running) return;
  ccConnectRuntimeStopping = true;
  if (ccConnectRuntimeRestartTimer) clearTimeout(ccConnectRuntimeRestartTimer);
  ccConnectRuntimeRestartTimer = null;
  try {
    await ccConnectSidecarManager?.stop();
    ccConnectSidecarManager = null;
    ccConnectRuntimeControlClient = null;
    deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    for (const accountId of ccConnectDeliveryAccounts)
      ccConnectDeliveryTransport?.detach(accountId);
    ccConnectDeliveryAccounts.clear();
    ccConnectRuntimeStatuses.clear();
    ccConnectRuntimeConfigSignature = '';
  } finally {
    ccConnectRuntimeStopping = false;
  }
  await startCcConnectRuntime(accounts, signature);
};

const reconcileCcConnectChannelSidecars = (): Promise<void> => {
  const operation = ccConnectRuntimeReconcileQueue.then(
    reconcileCcConnectChannelSidecarsNow,
    reconcileCcConnectChannelSidecarsNow,
  );
  ccConnectRuntimeReconcileQueue = operation.catch((): void => undefined);
  return operation;
};

const scheduleCcConnectRuntimeRestart = (): void => {
  if (ccConnectRuntimeRestartTimer || !ccConnectBridgeServer) return;
  const delayMs = Math.min(30_000, 1_000 * 2 ** ccConnectRuntimeRestartAttempts);
  ccConnectRuntimeRestartAttempts = Math.min(ccConnectRuntimeRestartAttempts + 1, 5);
  ccConnectRuntimeRestartTimer = setTimeout(() => {
    ccConnectRuntimeRestartTimer = null;
    void reconcileCcConnectChannelSidecars().catch(error => {
      console.error('[ChannelRuntime] Failed to restart unified runtime:', error);
      scheduleCcConnectRuntimeRestart();
    });
  }, delayMs);
};
let storeInitPromise: Promise<SqliteStore> | null = null;
let sqliteBackupManager: SqliteBackupManager | null = null;

let llamaCppManager: LlamaCppManager | null = null;
let ollamaManager: OllamaManager | null = null;

let piWorkbenchRuntimeForwarderBound = false;
let preventSleepBlockerId: number | null = null;
let appUpdateCoordinator: AppUpdateCoordinator | null = null;

function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (preventSleepBlockerId === null || !powerSaveBlocker.isStarted(preventSleepBlockerId)) {
      preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (preventSleepBlockerId !== null && powerSaveBlocker.isStarted(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId);
  }
  preventSleepBlockerId = null;
}

const initStore = async (): Promise<SqliteStore> => {
  if (!storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    // better-sqlite3 opens the database synchronously, so Promise.resolve() resolves
    // immediately. The timeout acts as a safety net for unexpected OS-level
    // blocking during store initialization and recovery.
    storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000),
      ),
    ]);
  }
  return storeInitPromise;
};

const getStore = (): SqliteStore => {
  if (!store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return store;
};

const getMainAgentWorkspace = (): string =>
  path.join(app.getPath('userData'), 'agent-workspaces', 'main');

const buildAvailableAgentProviders = (): Record<string, { models: Array<{ id: string }> }> => {
  const providerMap: Record<string, { models: Array<{ id: string }> }> = {};
  for (const provider of resolveAllEnabledProviderConfigs()) {
    for (const model of provider.models) {
      const models = (providerMap[provider.providerName] ??= { models: [] }).models;
      if (!models.some(entry => entry.id === model.id)) {
        models.push({ id: model.id });
      }
    }
  }
  return providerMap;
};

const getLlamaCppManager = (): LlamaCppManager => {
  if (!llamaCppManager) {
    llamaCppManager = new LlamaCppManager(() => getLlamaCppServiceConfig(getStore()));
  }
  return llamaCppManager;
};

const getOllamaManager = (): OllamaManager => {
  if (!ollamaManager) {
    ollamaManager = new OllamaManager(() => getOllamaServiceConfig(getStore()));
  }
  return ollamaManager;
};

const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!appUpdateCoordinator) {
    appUpdateCoordinator = new AppUpdateCoordinator(getStore());
  }
  return appUpdateCoordinator;
};

let appUpdatePollTimer: NodeJS.Timeout | null = null;
let lastSuccessfulAppUpdateCheckAt = 0;

const checkForAppUpdate = (): void => {
  void getAppUpdateCoordinator()
    .checkNow()
    .then(result => {
      if (result.success) lastSuccessfulAppUpdateCheckAt = Date.now();
    });
};

const startAppUpdatePolling = (): void => {
  if (appUpdatePollTimer) return;
  const startupDelay =
    APP_UPDATE_STARTUP_DELAY_MIN_MS +
    Math.floor(Math.random() * APP_UPDATE_STARTUP_DELAY_JITTER_MS);
  setTimeout(checkForAppUpdate, startupDelay);
  appUpdatePollTimer = setInterval(checkForAppUpdate, APP_UPDATE_POLL_INTERVAL_MS);
};

const getCoworkStore = () => {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getDatabase());
    const cleaned = coworkStore.autoDeleteNonPersonalMemories();
    if (cleaned > 0) {
      console.info(`[cowork-memory] Auto-deleted ${cleaned} non-personal/procedural memories`);
    }
  }
  return coworkStore;
};

let agentManager: AgentManager | null = null;
const getAgentManager = () => {
  if (!agentManager) {
    agentManager = new AgentManager(getCoworkStore());
  }
  return agentManager;
};

const resolveSessionWorkingDirectory = (options: { cwd?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

// Deferred gateway restart: when a config change requires a gateway restart
// but active cowork sessions or cron jobs exist, we defer the restart until
// all workloads complete.  A polling interval checks periodically; a hard
// timeout ensures the restart eventually happens even if a session hangs.

// 5 minutes hard cap

// Debounce state for channel account reconciliation.
// Merges rapid successive calls within a 500ms window to avoid redundant
// config writes and restart evaluations.  Only the *last* call's options
// are used for the debounced execution (except restartGatewayIfRunning,
// which is OR-merged so no request is silently dropped).

/** Project Pi Work/Chat events to renderer-owned cowork streams. */
const forwardPiWorkbenchRuntimeToRenderer = (runtime: PiRuntimeAdapter): void => {
  runtime.on('message', (sessionId: string, message: unknown) => {
    const safeMessage = sanitizeCoworkMessageForIpc(message);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.Message, { sessionId, message: safeMessage });
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward a message:', error);
      }
    });
  });

  runtime.on(
    'messageUpdate',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      const safeContent = truncateIpcString(content, IPC_UPDATE_CONTENT_MAX_CHARS);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send(CoworkStreamIpc.MessageUpdate, {
            sessionId,
            messageId,
            content: safeContent,
            metadata,
          });
        } catch (error) {
          console.error('[PiWorkbenchForwarder] failed to forward a message update:', error);
        }
      });
    },
  );

  runtime.on('toolActivity', (sessionId, event) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.ToolActivity, { sessionId, event });
      } catch (error) {
        console.error('[CoworkForwarder] failed to forward tool activity:', error);
      }
    });
  });

  runtime.on('queueUpdated', (sessionId, items) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.QueueUpdated, { sessionId, items });
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward queue update:', error);
      }
    });
  });

  runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
    if (runtime.getSessionConfirmationMode(sessionId) === 'text') {
      return;
    }
    const safeRequest = sanitizePermissionRequestForIpc(request);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.Permission, { sessionId, request: safeRequest });
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward a permission request:', error);
      }
    });
  });

  runtime.on('permissionDismiss', (requestId: string) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.PermissionDismiss, { requestId });
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to dismiss a permission request:', error);
      }
    });
  });

  runtime.on('sessionInterrupted', interruption => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.Interrupted, interruption);
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward a session interruption:', error);
      }
    });
  });

  runtime.on('complete', (sessionId: string, claudeSessionId: string | null) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(CoworkStreamIpc.Complete, { sessionId, claudeSessionId });
    });
  });

  runtime.on('error', (sessionId: string, error: import('../common/coworkError').CoworkError) => {
    try {
      getCoworkStore().updateSession(sessionId, { status: 'error' });
    } catch {
      /* ignore */
    }
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(CoworkStreamIpc.Error, { sessionId, error });
    });
  });
};

const bindPiWorkbenchRuntimeForwarder = (): void => {
  if (piWorkbenchRuntimeForwarderBound) return;

  forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter());
  piWorkbenchRuntimeForwarderBound = true;
};

const getSkillManager = () => {
  if (!skillManager) {
    skillManager = new SkillManager(getStore);
  }
  return skillManager;
};

const getMcpStore = () => {
  if (!mcpStore) {
    const sqliteStore = getStore();
    mcpStore = new McpStore(sqliteStore.getDatabase());
  }
  return mcpStore;
};

const MCP_BUILT_IN_DEFAULTS_DISABLED_KEY = 'mcp_builtin_defaults_disabled_v1';

const ensureBuiltInMcpDefaultsDisabled = (): void => {
  const store = getStore();
  if (store.get<boolean>(MCP_BUILT_IN_DEFAULTS_DISABLED_KEY)) return;

  for (const server of getMcpStore().listServers()) {
    if (server.isBuiltIn && server.enabled) {
      getMcpStore().setEnabled(server.id, false);
    }
  }
  store.set(MCP_BUILT_IN_DEFAULTS_DISABLED_KEY, true);
};

const FEISHU_CLI_TIMEOUT_MS = 120_000;
const FEISHU_CLI_INSTALL_TIMEOUT_MS = 300_000;
const FEISHU_CLI_AUTH_TIMEOUT_MS = 600_000;
const FEISHU_MCP_REGISTRY_ID = 'feishu';
const FEISHU_CLI_PACKAGE = '@larksuite/cli@1.0.93';

const getFeishuCliRoot = (): string => path.join(app.getPath('userData'), 'MCPs', 'feishu', 'cli');

const getLocalFeishuCliCommand = (): string | null => {
  const binName = process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli';
  const command = path.join(getFeishuCliRoot(), 'node_modules', '.bin', binName);
  return fs.existsSync(command) ? command : null;
};

const decodeFeishuCliOutput = (chunks: Buffer[]): string => {
  const bytes = Buffer.concat(chunks);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('gb18030', { fatal: false }).decode(bytes);
};

const runFeishuCliCommand = (
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs = FEISHU_CLI_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env };
    // lark-cli's generated launcher invokes `node` through PATH. Use the
    // application runtime here as well as for its initial npm installation.
    applyApplicationRuntimeEnv(env, { includePackageMirrors: true });
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      env: {
        ...env,
        ...(args[0]?.toLowerCase().endsWith('npm-cli.js') ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    });
    const outputChunks: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const abort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill();
      reject(new Error('MCP authorization was cancelled'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => signal?.removeEventListener('abort', abort);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finish();
      child.kill();
      reject(new Error(`Feishu CLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', chunk =>
      outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.stderr.on('data', chunk =>
      outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.once('error', error => {
      if (settled) return;
      settled = true;
      finish();
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      finish();
      if (timer) clearTimeout(timer);
      const output = decodeFeishuCliOutput(outputChunks).trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });

const findFeishuCliCommand = async (): Promise<string | null> => {
  return getLocalFeishuCliCommand();
};

const installFeishuCli = async (cliRoot: string, force = false): Promise<void> => {
  const bundledNpm = resolveBundledNpmRuntime(NpmCli.Npm, [
    'install',
    '--prefix',
    cliRoot,
    '--no-save',
    '--no-audit',
    '--no-fund',
    ...(force ? ['--force'] : []),
    FEISHU_CLI_PACKAGE,
  ]);
  if (!bundledNpm)
    throw new Error('Bundled npm runtime is unavailable. Please reinstall the application.');
  await runFeishuCliCommand(
    bundledNpm.command,
    bundledNpm.args,
    cliRoot,
    FEISHU_CLI_INSTALL_TIMEOUT_MS,
  );
};

const verifyFeishuCli = async (command: string, cliRoot: string): Promise<void> => {
  await runFeishuCliCommand(command, ['--version'], cliRoot);
};

const prepareFeishuCli = async (): Promise<void> => {
  let cliCommand = await findFeishuCliCommand();
  const cliRoot = getFeishuCliRoot();
  fs.mkdirSync(cliRoot, { recursive: true });
  if (cliCommand) {
    try {
      await verifyFeishuCli(cliCommand, cliRoot);
    } catch (error) {
      console.warn('[Feishu] CLI health check failed, reinstalling the pinned version:', error);
      await installFeishuCli(cliRoot, true);
      cliCommand = await findFeishuCliCommand();
    }
  } else {
    await installFeishuCli(cliRoot);
    cliCommand = await findFeishuCliCommand();
  }
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  await verifyFeishuCli(cliCommand, cliRoot);

  try {
    await runFeishuCliCommand(cliCommand, ['config', 'show'], cliRoot);
  } catch {
    await runFeishuCliCommand(cliCommand, ['config', 'init', '--new', '--lang', 'en'], cliRoot);
  }
};

const authorizeFeishuCli = async (signal?: AbortSignal): Promise<void> => {
  await prepareFeishuCli();
  const cliCommand = await findFeishuCliCommand();
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  const cliRoot = getFeishuCliRoot();

  const authOutput = await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--recommend', '--no-wait', '--json'],
    cliRoot,
    FEISHU_CLI_TIMEOUT_MS,
    signal,
  );
  let authPayload: { device_code?: string; verification_url?: string } | null = null;
  for (const line of authOutput.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        authPayload = parsed as { device_code?: string; verification_url?: string };
        break;
      }
    } catch {
      // The CLI may include human-readable notices around its JSON output.
    }
  }
  if (!authPayload?.device_code || !authPayload.verification_url) {
    throw new Error('Feishu CLI did not return a browser authorization URL');
  }
  await shell.openExternal(authPayload.verification_url);
  await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--device-code', authPayload.device_code, '--json'],
    cliRoot,
    FEISHU_CLI_AUTH_TIMEOUT_MS,
    signal,
  );
  await runFeishuCliCommand(cliCommand, ['auth', 'status'], cliRoot, FEISHU_CLI_TIMEOUT_MS, signal);
};

const logoutFeishuCli = async (): Promise<void> => {
  const cliCommand = await findFeishuCliCommand();
  if (!cliCommand) return;

  await runFeishuCliCommand(cliCommand, ['auth', 'logout'], getFeishuCliRoot());
  console.log('[Feishu] official CLI authorization removed');
};

const resolveBundledFeishuSkills = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath, 'MCPs', 'feishu', 'skills'),
    path.join(app.getAppPath(), 'MCPs', 'feishu', 'skills'),
    path.join(process.cwd(), 'MCPs', 'feishu', 'skills'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
};

const installFeishuSkills = (): void => {
  const source = resolveBundledFeishuSkills();
  if (!source) throw new Error('Bundled Feishu skills were not found');
  // Keep connector-provided skills in the per-user directory. This avoids
  // mutating the checked-out development SKILLs tree while still letting the
  // Agent load them through its user extraDirs configuration.
  const target = path.join(app.getPath('userData'), 'MCPs', 'feishu', 'skills');
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.cpSync(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
      force: true,
    });
  }
  console.log('[Feishu] official CLI skills installed for the Agent');
};

const removeFeishuSkills = (): void => {
  const target = path.join(app.getPath('userData'), 'MCPs', 'feishu', 'skills');
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  console.log('[Feishu] official CLI skills removed from the Agent');
};

const refreshMcpOAuthHeaders = async <
  T extends { id: string; registryId?: string; url?: string; headers?: Record<string, string> },
>(
  servers: T[],
): Promise<T[]> => {
  const oauthManager = new McpOAuthManager(getStore());
  return Promise.all(
    servers.map(async server => {
      if (!server.registryId || !server.url) return server;
      try {
        const accessToken = await oauthManager.refreshAccessToken(server.registryId, server.url);
        if (!accessToken) return server;
        const headers = { ...server.headers, Authorization: `Bearer ${accessToken}` };
        getMcpStore().updateServer(server.id, { headers });
        return { ...server, headers };
      } catch (error) {
        console.warn(
          `[McpAuth] failed to refresh OAuth token for ${server.registryId}; using the stored token:`,
          error,
        );
        return server;
      }
    }),
  );
};

/**
 * Initialize MCP servers and discover tools.
 *
 * Safe to call from any Pi initialization context.
 * deduplicates concurrent calls via a promise lock and skips if the
 * McpServerManager is already running.
 *
 * Returns the tool manifest (may be empty if no MCP servers are configured).
 */
const initMcpServers = async (): Promise<McpToolManifestEntry[]> => {
  if (mcpInitPromise) return mcpInitPromise;
  const generation = mcpLifecycleGeneration;

  mcpInitPromise = (async (): Promise<McpToolManifestEntry[]> => {
    try {
      ensureBuiltInMcpDefaultsDisabled();
      const enabledServers = await refreshMcpOAuthHeaders(getMcpStore().getEnabledServers());
      if (enabledServers.length === 0) {
        console.log('[McpInit] No MCP servers configured, skipping');
        return [];
      }

      if (!mcpServerManager) {
        mcpServerManager = new McpServerManager();
      }

      // If already running (e.g. initMcpServers called before startMcpBridge),
      // reuse the existing connections instead of restarting.
      if (mcpServerManager.isRunning) {
        const count = mcpServerManager.toolManifest.length;
        console.log(`[McpInit] MCP already running, reusing ${count} tools`);
        return mcpServerManager.toolManifest;
      }

      console.log(`[McpInit] Starting ${enabledServers.length} MCP servers...`);
      const tools = await mcpServerManager.startServers(enabledServers);
      if (generation !== mcpLifecycleGeneration) {
        await mcpServerManager.stopServers();
        return [];
      }
      console.log(`[McpInit] MCP servers started: ${tools.length} tools discovered`);
      syncPiMcpToolManifest();
      return tools;
    } catch (err) {
      console.error('[McpInit] Failed to start MCP servers:', err);
      return [];
    }
  })().finally(() => {
    mcpInitPromise = null;
  });

  return mcpInitPromise;
};

/**
 * Pi sessions capture their custom-tool topology at creation time. Keep an
 * already-created Pi runtime synchronized after both startup discovery and
 * later connector refreshes without instantiating Pi just for MCP bootstrap.
 */
const syncPiMcpToolManifest = (): void => {
  if (!piRuntimeAdapter || !mcpServerManager) return;
  if (!piRuntimeAdapter.hasMcpServerManager()) {
    piRuntimeAdapter.setMcpServerManager(mcpServerManager);
    return;
  }
  piRuntimeAdapter.refreshMcpTools();
};

/**
 * Refresh in-process MCP servers after configuration changes.
 * Returns a summary for the renderer to display.
 */
let mcpBridgeRefreshPromise: Promise<{ tools: number; error?: string }> | null = null;
let mcpBridgeRefreshPending = false;

const broadcastMcpBridgeSync = (channel: string, data?: Record<string, unknown>): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send(channel, data ?? {});
    } catch (error) {
      console.error(`[McpBridge] Failed to broadcast ${channel}:`, error);
    }
  });
};

const refreshMcpBridge = (): Promise<{ tools: number; error?: string }> => {
  if (mcpBridgeRefreshPromise) {
    // A server setting changed while the current pass was reading the enabled
    // list. Schedule one more pass after it completes so the bridge converges
    // on the latest persisted configuration.
    mcpBridgeRefreshPending = true;
    return mcpBridgeRefreshPromise;
  }
  mcpBridgeRefreshPromise = (async () => {
    try {
      const generation = ++mcpLifecycleGeneration;
      console.log('[McpBridge] refreshing after config change...');
      broadcastMcpBridgeSync('mcp:bridge:syncStart');

      // 1. Stop existing MCP servers (but keep HTTP callback server alive — port stays the same)
      if (mcpServerManager) {
        await mcpServerManager.stopServers();
      }
      // Invalidate any in-flight discovery promise. The next bridge start must
      // read the current enabled-server list after a delete/disable operation.
      mcpInitPromise = null;
      // Re-discover tools from the new set of enabled servers.
      const tools = await initMcpServers();
      if (generation !== mcpLifecycleGeneration) {
        return { tools: 0, error: 'MCP configuration changed during refresh' };
      }
      const toolCount = tools.length;
      console.log(`[McpBridge] refresh: ${toolCount} tools discovered`);

      // Pi's custom tool topology is captured when a session is created.
      // Mark live sessions stale after discovery so their next user turn is
      // rebuilt with the freshly discovered MCP proxy instead of relying on
      // whichever servers happened to be ready during app startup.
      syncPiMcpToolManifest();
      console.log(`[McpBridge] refresh complete: ${toolCount} tools discovered`);
      return { tools: toolCount };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[McpBridge] refresh error:', msg);
      return { tools: 0, error: msg };
    }
  })()
    .then(result => {
      broadcastMcpBridgeSync('mcp:bridge:syncDone', { tools: result.tools, error: result.error });
      return result;
    })
    .catch(err => {
      const error = err instanceof Error ? err.message : String(err);
      broadcastMcpBridgeSync('mcp:bridge:syncDone', { tools: 0, error });
      return { tools: 0, error };
    })
    .finally(() => {
      mcpBridgeRefreshPromise = null;
      if (mcpBridgeRefreshPending) {
        mcpBridgeRefreshPending = false;
        void refreshMcpBridge();
      }
    });
  return mcpBridgeRefreshPromise;
};

const getIMGatewayManager = () => {
  if (!imGatewayManager) {
    imGatewayManager = new ChannelAccountManager(getStore().getDatabase(), async accountId => {
      await refreshCcConnectPlatformStatuses();
      return resolveCcConnectAccountRuntimeStatus(
        ccConnectRuntimeStatuses,
        accountId,
        ccConnectSidecarManager?.running === true,
      );
    });
  }
  return imGatewayManager;
};

const resolveCoworkPromptLanguage = (): CoworkPromptLanguage => {
  const configuredLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
  return configuredLanguage === 'en' ? 'en' : 'zh';
};

const haveSameExpertSnapshots = (
  left: CoworkSessionExpertSnapshot[],
  right: CoworkSessionExpertInput[],
): boolean =>
  left.length === right.length &&
  left.every(
    (expert, index) =>
      expert.expertId === right[index]?.expertId &&
      expert.contentHash === right[index]?.contentHash,
  );

const haveSameExpertIds = (
  experts: CoworkSessionExpertSnapshot[],
  requestedExpertIds: string[],
): boolean => {
  const normalizedIds = normalizeSingleExpertIds(requestedExpertIds);
  return (
    experts.length === normalizedIds.length &&
    experts.every((expert, index) => expert.expertId === normalizedIds[index])
  );
};

const resolveSessionExpertSnapshots = (expertIds: string[]): CoworkSessionExpertInput[] => {
  const normalizedExpertIds = normalizeSingleExpertIds(expertIds);
  const snapshots: CoworkSessionExpertInput[] = [];
  for (const expertId of normalizedExpertIds) {
    const expert = getAgentManager().getAgent(expertId);
    if (
      !expert ||
      (expert.source !== CoworkSessionExpertSource.Package &&
        expert.source !== CoworkSessionExpertSource.Member)
    ) {
      throw new Error(`Expert '${expertId}' is not installed or is not an expert package agent`);
    }
    let promptSnapshot = expert.systemPrompt.trim();
    const packageId = expert.presetId.trim() || expert.id;
    let skillIds = [...expert.skillIds];

    // Bundled presets are file-sourced like regular skills: the preset
    // markdown is read live on every session so editing the preset takes
    // effect without re-importing. The DB snapshot remains the fallback
    // when the preset directory is missing or unreadable.
    if (expert.presetId.trim()) {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
      // The main session loads only the selected agent's file: the lead for
      // teams, the single file for standalone agents.
      const liveSnapshot = resolveBundledPresetExpertSnapshot(
        bundledSkillsRoot,
        packageId,
        expert.id,
      );
      if (liveSnapshot) {
        promptSnapshot = liveSnapshot.promptSnapshot;
        skillIds = liveSnapshot.skillIds;
      }
    }

    if (!promptSnapshot) {
      throw new Error(`Expert '${expertId}' has an empty system prompt`);
    }
    const contentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ packageId, expertId: expert.id, promptSnapshot, skillIds }))
      .digest('hex');
    snapshots.push({
      expertId: expert.id,
      packageId,
      expertName: expert.name,
      source: expert.source,
      promptSnapshot,
      skillIds,
      capabilityPolicy: {},
      contentHash,
    });
  }
  return snapshots;
};

// 获取正确的预加载脚本路径
const PRELOAD_PATH = app.isPackaged
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '../dist-electron/preload.js');

// 获取应用图标路径（与安装包/桌面快捷方式保持一致，不复用系统托盘图标）
const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  if (app.isPackaged) {
    const packagedIconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    return path.join(process.resourcesPath, 'app-icons', packagedIconName);
  }

  const developmentIconPath =
    process.platform === 'win32' ? path.join('win', 'icon.ico') : path.join('png', '256x256.png');
  return path.join(__dirname, '..', 'build', 'icons', developmentIconPath);
};

// 保存对主窗口的引用
let mainWindow: BrowserWindow | null = null;

let isQuitting = false;

// 存储活跃的流式请求控制器
const activeStreamControllers = new Map<string, AbortController>();
let lastReloadAt = 0;
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_RELOAD_INTERVAL_MS = 5000;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300;
type AppConfigSettings = {
  theme?: string;
  language?: string;
  useSystemProxy?: boolean;
  sqliteAutoBackupEnabled?: boolean;
};

const getUseSystemProxyFromConfig = (config?: { useSystemProxy?: boolean }): boolean => {
  return config?.useSystemProxy === true;
};

const getSqliteAutoBackupEnabledFromConfig = (config?: {
  sqliteAutoBackupEnabled?: boolean;
}): boolean => {
  return config?.sqliteAutoBackupEnabled === true;
};

const resolveThemeFromConfig = (config?: AppConfigSettings): 'light' | 'dark' => {
  if (config?.theme === 'dark') {
    return 'dark';
  }
  if (config?.theme === 'light') {
    return 'light';
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

const getInitialTheme = (): 'light' | 'dark' => {
  const config = getStore().get<AppConfigSettings>('app_config');
  return resolveThemeFromConfig(config);
};

const getTitleBarOverlayOptions = () => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

const updateTitleBarOverlay = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

const applyProxyPreference = async (useSystemProxy: boolean): Promise<void> => {
  setSystemProxyEnabled(useSystemProxy);

  try {
    await session.defaultSession.setProxy({ mode: useSystemProxy ? 'system' : 'direct' });
  } catch (error) {
    console.error('[Main] Failed to apply session proxy mode:', error);
  }

  if (!useSystemProxy) {
    restoreOriginalProxyEnv();
    console.log('[Main] System proxy disabled (direct mode).');
    return;
  }

  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets();
  applySystemProxyEnv(proxyUrl);

  if (proxyUrl) {
    console.log(`[Main] System proxy enabled for process env via ${targetUrl}:`, proxyUrl);
  } else {
    console.warn('[Main] System proxy mode enabled, but no proxy endpoint was resolved (DIRECT).');
  }
};

const emitWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', {
    isMaximized: mainWindow.isMaximized(),
    isFullscreen: mainWindow.isFullScreen(),
    isFocused: mainWindow.isFocused(),
  });
};

const getDisplayWorkAreas = (): WindowRectangle[] => {
  return screen.getAllDisplays().map(display => display.workArea);
};

const getCurrentAppWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const bounds = mainWindow.isFullScreen()
    ? mainWindow.getNormalBounds()
    : mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized(),
  };
};

const persistAppWindowState = () => {
  const state = getCurrentAppWindowState();
  if (!state) return;
  getStore().set(AppWindowStoreKey.State, state);
};

const schedulePersistAppWindowState = () => {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }

  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    persistAppWindowState();
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isMaximized = mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => mainWindow.restore() },
    { role: 'minimize' },
    { label: 'Maximize', enabled: !isMaximized, click: () => mainWindow.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

const scheduleReload = (reason: string, webContents?: WebContents) => {
  if (isQuitting) {
    console.debug(`[RendererProcess] Skipping reload during shutdown (${reason}).`);
    return;
  }
  const target = webContents ?? mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`Skipping reload (${reason}); last reload was ${now - lastReloadAt}ms ago.`);
    return;
  }
  lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};

// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

/**
 * Linux only: 检测单实例锁被哪个"知远"实例持有。
 *
 * 返回 null 表示没有可接管的目标(同版本多开或未检测到),此时由第一实例
 * 的 second-instance 处理唤起已有窗口,本实例直接退出。
 * 返回 { pids, oldLabel } 表示存在"旧版本"实例,需要用户确认后接管。
 *
 * 身份判定:
 *  - AppImage:运行时环境变量 APPIMAGE 指向源文件(文件名含版本号),
 *    与当前进程的 APPIMAGE 不同即视为旧版本
 *  - deb:/opt/知远 下的进程无 APPIMAGE,exe 路径匹配即视为同族;
 *    无法区分版本,统一按"旧实例"提示确认
 */
async function findStaleLinuxInstances(): Promise<{
  pids: number[];
  oldLabel: string;
} | null> {
  if (process.platform !== 'linux') return null;

  const currentAppImage = process.env.APPIMAGE ?? null;
  const familyPattern = /知远|ZhiYuanAgent/i;

  const pids: number[] = [];
  const oldAppImages: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      const appImage = env.match(/APPIMAGE=([^\0]*)/)?.[1] ?? null;
      if (appImage) {
        if (!familyPattern.test(appImage)) continue;
        // 同一版本文件的多开:唤起已有窗口即可,不接管
        if (currentAppImage && appImage === currentAppImage) continue;
        pids.push(pid);
        oldAppImages.push(appImage);
      } else {
        // 非 AppImage:匹配 deb 安装路径 /opt/知远
        const exe = fs.readlinkSync(`/proc/${pid}/exe`);
        if (!/\/opt\/知远/.test(exe)) continue;
        pids.push(pid);
      }
    } catch {
      // 权限不足或进程已退出,跳过
    }
  }
  if (pids.length === 0) return null;

  // 从 AppImage 文件名提取旧版本号,如 知远-1.0.0.AppImage → 1.0.0
  const versionMatch = oldAppImages[0]?.match(/-(\d+\.\d+\.\d+)\.AppImage/i);
  const oldLabel = versionMatch ? `知远 ${versionMatch[1]}` : '旧版本的知远';
  return { pids, oldLabel };
}

/** 终止指定进程并等待退出(最多 5 秒)。 */
async function terminatePids(pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 已退出或无权,忽略
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const alive = pids.filter(pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (alive.length === 0) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

if (!gotTheLock) {
  void (async () => {
    // 同版本多开:第一实例已通过 second-instance 聚焦窗口,本实例直接退出。
    const stale = await findStaleLinuxInstances();
    if (stale) {
      // 旧版本实例(AppImage 替换):弹窗确认后再接管,避免中断用户正在进行
      // 的会话。确认后终止旧实例并 relaunch,让新进程重新拿锁启动。
      console.warn(
        `[Main] Detected running ${stale.oldLabel} instance (pid ${stale.pids.join(', ')}); asking user before takeover.`,
      );
      try {
        await app.whenReady();
        const currentVersion = app.getVersion();
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['关闭旧版本并启动新版本', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: '检测到旧版本正在运行',
          message: `检测到 ${stale.oldLabel} 正在运行。`,
          detail:
            `当前启动的是知远 ${currentVersion}。启动新版本需要先关闭旧版本,` +
            '关闭旧版本将中断其中进行中的任务。是否继续?',
        });
        if (response === 1) {
          app.exit(0);
          return;
        }
      } catch {
        // 无显示环境(如无头 CI):无法确认,直接退出
        app.exit(0);
        return;
      }
      const terminated = await terminatePids(stale.pids);
      if (!terminated) {
        console.warn('[Main] Stale instance did not exit in time; giving up takeover.');
        app.exit(0);
        return;
      }
      app.relaunch();
      app.exit(0);
      return;
    }
    console.warn('[Main] Another ZhiYuanAgent instance is already running; exiting.');
    app.exit(0);
  })();
} else {
  // In development Electron needs the app entry point before the callback URL;
  // otherwise Windows treats the URL itself as the application to launch.
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('zhiyuan', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('zhiyuan');
  }

  const COMMUNITY_AUTH_ORIGIN = 'https://account.rongxzyai.com';
  const COMMUNITY_AUTH_SESSION_KEY = 'community_auth_session_v1';
  let pendingCommunityLogin: { state: string; verifier: string; expiresAt: number } | null = null;

  type CommunityAuthPayload = Record<string, unknown>;

  async function readCommunityAuthPayload(
    response: Response,
  ): Promise<CommunityAuthPayload | null> {
    const rawText = await response.text();
    if (!rawText) return null;

    try {
      const payload: unknown = JSON.parse(rawText);
      return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as CommunityAuthPayload)
        : null;
    } catch {
      return null;
    }
  }

  /** Parse a zhiyuan:// deep link for the pending community login. */
  const handleDeepLink = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        if (code && state && pendingCommunityLogin?.state === state) {
          void completeCommunityLogin(code, state);
          return;
        }
        console.warn('[CommunityAuth] Ignoring unexpected auth callback');
      }
    } catch (e) {
      console.error('[Main] Failed to parse deep link:', e);
    }
  };

  ipcMain.on('log:fromRenderer', (_event, level: string, tag: string, message: string) => {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[Renderer][${tag}] ${message}`);
  });

  // macOS: handle open-url event for deep links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.debug('[Main] second-instance event', { commandLine, workingDirectory });

    // Check for deep link in command line args (Windows/Linux)
    const deepLink = commandLine.find(arg => arg.startsWith('zhiyuan://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }

    // Focus main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  });

  // IPC 处理程序
  ipcMain.handle('store:get', (_event, key) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key, value) => {
    getStore().set(key, value);
    if (key === 'app_config') {
      refreshEndpointsTestMode(getStore());
    }
  });

  ipcMain.handle('store:remove', (_event, key) => {
    getStore().delete(key);
  });

  ipcMain.handle('enterprise:getConfig', async () => {
    try {
      return getStore().get('enterprise_config') ?? null;
    } catch {
      return null;
    }
  });
  ipcMain.handle(EnterpriseSessionIpc.Snapshot, () => zhiyuanEnterpriseSessionBridge.snapshot());
  ipcMain.handle(EnterpriseSessionIpc.Login, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.login(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.ChangePassword, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.changePassword(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.Logout, () => zhiyuanEnterpriseSessionBridge.logout());
  ipcMain.handle(EnterpriseRendererIpc.SessionGateEntrypoint, () =>
    zhiyuanEnterpriseRendererBridge.sessionGateEntrypoint(),
  );
  ipcMain.handle(EnterpriseRendererIpc.SettingsPages, () =>
    zhiyuanEnterpriseRendererBridge.settingsPages(),
  );
  ipcMain.handle(ManagedProviderIpc.Policy, () => zhiyuanManagedProviderBridge.accessPolicy());
  ipcMain.handle(ManagedProviderIpc.Catalog, () => zhiyuanManagedProviderBridge.catalog());
  zhiyuanManagedProviderBridge.onDidChange(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(ManagedProviderIpc.Changed);
    }
  });

  ipcMain.handle('hardware:nvidia-smi', async () => getNvidiaSmiSnapshot());
  ipcMain.handle(HardwareIpc.SystemMemory, async () => getSystemMemorySnapshot());

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);

    if (status === 'online' && imGatewayManager) {
      console.log('[Main] Network restored, reconciling channel sidecars...');
      void reconcileCcConnectChannelSidecars();
    }
  });

  // Log IPC handlers
  ipcMain.handle('log:getPath', () => {
    return getLogFilePath();
  });

  ipcMain.handle('log:openFolder', () => {
    const logPath = getLogFilePath();
    if (logPath) {
      shell.showItemInFolder(logPath);
    }
  });

  ipcMain.handle('log:exportZip', async event => {
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        return { success: false, error: 'Window is not available' };
      }

      const saveOptions = {
        title: 'Export Logs',
        defaultPath: path.join(app.getPath('downloads'), buildLogExportFileName()),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      };

      const saveResult = await dialog.showSaveDialog(ownerWindow, saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true };
      }

      const outputPath = ensureZipFileName(saveResult.filePath);
      const archiveResult = await exportLogsZip({
        outputPath,
        entries: [
          ...getRecentMainLogEntries(),
          { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
          ...(process.platform === 'win32'
            ? [
                {
                  archiveName: 'install-timing.log',
                  filePath: path.join(
                    app.getPath('appData'),
                    APP_DATA_DIR_NAME,
                    'install-timing.log',
                  ),
                },
              ]
            : []),
        ],
      });

      return {
        success: true,
        canceled: false,
        path: outputPath,
        missingEntries: archiveResult.missingEntries,
      };
    } catch (error) {
      console.error('[LogExport] export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export logs',
      };
    }
  });

  // Auto-launch IPC handlers
  // Use SQLite store as the source of truth for UI state, because
  // app.getLoginItemSettings() returns unreliable values on macOS and
  // requires matching args on Windows.
  ipcMain.handle('app:getAutoLaunch', () => {
    const stored = getStore().get<boolean>('auto_launch_enabled');
    // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
    const enabled = stored ?? getAutoLaunchEnabled();
    return { enabled };
  });

  ipcMain.handle('app:setAutoLaunch', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setAutoLaunchEnabled(enabled);
      getStore().set('auto_launch_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set auto-launch',
      };
    }
  });

  ipcMain.handle('app:getPreventSleep', () => {
    const enabled = getStore().get<boolean>('prevent_sleep_enabled') ?? false;
    return { enabled };
  });

  ipcMain.handle('app:setPreventSleep', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setPreventSleepBlockerEnabled(enabled);
      getStore().set('prevent_sleep_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set prevent-sleep',
      };
    }
  });

  ipcMain.handle('app:relaunch', () => {
    console.log('[Main] app:relaunch requested, scheduling restart...');
    recordAppQuitOrigin(AppQuitOrigin.RendererRelaunch);
    app.relaunch();
    app.quit();
  });

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.on(
    'window:showSystemMenu',
    (_event, position: { x?: number; y?: number } | undefined) => {
      showSystemMenu(position);
    },
  );

  ipcMain.handle(AppIpc.GetVersion, () => app.getVersion());
  ipcMain.handle(AppIpc.GetSystemLocale, () => app.getLocale());
  ipcMain.handle(AppIpc.ConsumePendingLocalInferenceInstall, () =>
    consumePendingLocalInferenceInstall(app.getPath('userData')),
  );

  // ── Community auth IPC handlers ──

  type CommunityAuthSession = {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };

  const canPersistCommunitySession = () => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
  };

  const saveCommunitySession = (value: CommunityAuthSession) => {
    if (!canPersistCommunitySession()) {
      throw new Error(
        'System secure storage is unavailable; the login session cannot be saved safely.',
      );
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    getStore().set(COMMUNITY_AUTH_SESSION_KEY, { version: 1, encrypted });
  };

  const getCommunitySession = (): CommunityAuthSession | null => {
    const stored = getStore().get<{ version?: unknown; encrypted?: unknown }>(
      COMMUNITY_AUTH_SESSION_KEY,
    );
    if (
      stored?.version !== 1 ||
      typeof stored.encrypted !== 'string' ||
      !canPersistCommunitySession()
    )
      return null;
    try {
      const decoded = JSON.parse(
        safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')),
      ) as CommunityAuthSession;
      if (
        !decoded.accessToken ||
        !decoded.refreshToken ||
        !decoded.user?.id ||
        !decoded.user?.email
      )
        throw new Error('invalid session');
      return decoded;
    } catch {
      getStore().delete(COMMUNITY_AUTH_SESSION_KEY);
      return null;
    }
  };

  const clearCommunitySession = () => getStore().delete(COMMUNITY_AUTH_SESSION_KEY);

  ipcMain.handle(CommunityAuthIpc.GetCommunityUser, () => {
    const session = getCommunitySession();
    return session ? { success: true, user: session.user } : { success: false };
  });

  ipcMain.handle(CommunityAuthIpc.Logout, () => {
    clearCommunitySession();
    return { success: true };
  });

  async function completeCommunityLogin(code: string, state: string): Promise<void> {
    const pending = pendingCommunityLogin;
    pendingCommunityLogin = null;
    if (!pending || pending.state !== state || pending.expiresAt < Date.now()) return;
    try {
      const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: pending.verifier,
          redirect_uri: 'zhiyuan://auth/callback',
        }),
      });
      const payload = await readCommunityAuthPayload(response);
      const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : null;
      const refreshToken =
        typeof payload?.refresh_token === 'string' ? payload.refresh_token : null;
      const user =
        payload?.user && typeof payload.user === 'object' && !Array.isArray(payload.user)
          ? (payload.user as CommunityAuthPayload)
          : null;
      const userId = typeof user?.id === 'string' ? user.id : null;
      const userEmail = typeof user?.email === 'string' ? user.email : null;
      if (!response.ok || !accessToken || !refreshToken || !userId || !userEmail) {
        console.warn(
          `[CommunityAuth] token exchange returned an invalid response with status ${response.status}`,
        );
        throw new Error('Token exchange failed');
      }
      saveCommunitySession({
        accessToken,
        refreshToken,
        user: { id: userId, email: userEmail },
      });
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: true,
        user: { id: userId, email: userEmail, name: userEmail },
      });
      if (mainWindow?.isMinimized()) mainWindow.restore();
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
      mainWindow?.focus();
    } catch (error) {
      console.warn(
        '[CommunityAuth] login callback failed:',
        error instanceof Error ? error.message : error,
      );
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: false,
        error: t('communityAuthLoginIncomplete'),
      });
    }
  }

  ipcMain.handle(CommunityAuthIpc.Login, async () => {
    try {
      if (!canPersistCommunitySession()) {
        return { success: false, error: '系统安全存储不可用，无法安全地保存登录状态。' };
      }
      const verifier = crypto.randomBytes(48).toString('base64url');
      const state = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: 'zhiyuan://auth/callback',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }),
      });
      const payload = await readCommunityAuthPayload(response);
      const loginUrl = typeof payload?.login_url === 'string' ? payload.login_url : null;
      if (!response.ok || !loginUrl || !loginUrl.startsWith(`${COMMUNITY_AUTH_ORIGIN}/`)) {
        console.warn(
          `[CommunityAuth] login initialization returned an invalid response with status ${response.status}`,
        );
        return { success: false, error: t('communityAuthServiceUnavailable') };
      }
      pendingCommunityLogin = { state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 };
      await shell.openExternal(loginUrl);
      return { success: true };
    } catch (error) {
      console.error('[Auth] login failed:', error);
      return {
        success: false,
        error: t('communityAuthServiceUnavailable'),
      };
    }
  });

  // Skills IPC handlers
  ipcMain.handle('skills:list', () => {
    try {
      const skills = getSkillManager().listSkills();
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load skills',
      };
    }
  });

  ipcMain.handle(SkillsIpc.SetEnabled, (_event, options: { id: string; enabled: boolean }) => {
    try {
      const skills = getSkillManager().setSkillEnabled(options.id, options.enabled);
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update skill',
      };
    }
  });

  ipcMain.handle(
    SkillsIpc.SetEnabledBatch,
    (_event, options: { ids: string[]; enabled: boolean }) => {
      try {
        const skills = getSkillManager().setSkillsEnabled(options.ids, options.enabled);
        return { success: true, skills };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update skills',
        };
      }
    },
  );

  ipcMain.handle(SkillsIpc.SetPinned, (_event, options: { id: string; pinned: boolean }) => {
    try {
      const skills = getSkillManager().setSkillPinned(options.id, options.pinned);
      return { success: true, skills };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update skill',
      };
    }
  });

  ipcMain.handle('skills:delete', async (_event, id: string) => {
    try {
      const skills = await getSkillManager().deleteSkill(id);
      return { success: true, skills };
    } catch (error) {
      console.error('[skills] Failed to delete skill:', id, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete skill',
      };
    }
  });

  ipcMain.handle(
    'skills:download',
    async (_event, source: string, options?: { iconUrl?: string; displayName?: string }) => {
      return getSkillManager().downloadSkill(source, options);
    },
  );

  ipcMain.handle('skills:confirmInstall', async (_event, pendingId: string, action: string) => {
    const validActions = ['install', 'installDisabled', 'cancel'];
    if (!validActions.includes(action)) {
      return { success: false, error: 'Invalid action' };
    }
    return getSkillManager().confirmPendingInstall(
      pendingId,
      action as 'install' | 'installDisabled' | 'cancel',
    );
  });

  ipcMain.handle('skills:getRoot', () => {
    try {
      const root = getSkillManager().getSkillsRoot();
      return { success: true, path: root };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve skills root',
      };
    }
  });

  ipcMain.handle(SkillsIpc.GetContent, async (_event, skillId: string) => {
    return getSkillManager().getSkillContent(skillId);
  });

  ipcMain.handle('skills:autoRoutingPrompt', () => {
    try {
      const prompt = getSkillManager().buildAutoRoutingPrompt();
      return { success: true, prompt };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build auto-routing prompt',
      };
    }
  });

  ipcMain.handle('skills:getConfig', (_event, skillId: string) => {
    return getSkillManager().getSkillConfig(skillId);
  });

  ipcMain.handle(
    'skills:setConfig',
    async (_event, skillId: string, config: Record<string, string>) => {
      const result = getSkillManager().setSkillConfig(skillId, config);
      return result;
    },
  );

  ipcMain.handle(
    'skills:testEmailConnectivity',
    async (_event, skillId: string, config: Record<string, string>) => {
      return getSkillManager().testEmailConnectivity(skillId, config);
    },
  );

  ipcMain.handle(
    SkillsIpc.FetchMarketplace,
    async (_event, options?: { pageNumber?: number; pageSize?: number }) => {
      try {
        const userToken = getStore().get<string>(ModelScopeStoreKey.ApiToken);
        const token = createModelScopeTokenPool({
          extraTokens: userToken ? [userToken] : [],
        }).nextToken();
        console.log('[SkillMarketplace] fetching skills from ModelScope OpenAPI');
        const data = await fetchModelScopeSkillMarketplace({
          token,
          pageNumber: options?.pageNumber,
          pageSize: options?.pageSize,
          fetchImpl: (input, init) =>
            session.defaultSession.fetch(input, init as RequestInit) as unknown as ReturnType<
              typeof fetch
            >,
        });
        return { success: true, data };
      } catch (error) {
        console.error('[SkillMarketplace] fetch error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch skill marketplace',
        };
      }
    },
  );

  ipcMain.handle(SkillsIpc.FetchMarketplaceContent, async (_event, skillId: string) => {
    try {
      const userToken = getStore().get<string>(ModelScopeStoreKey.ApiToken);
      const token = createModelScopeTokenPool({
        extraTokens: userToken ? [userToken] : [],
      }).nextToken();
      const content = await fetchModelScopeSkillContent(skillId, {
        token,
        fetchImpl: (input, init) =>
          session.defaultSession.fetch(input, init as RequestInit) as unknown as ReturnType<
            typeof fetch
          >,
      });
      return { success: true, content };
    } catch (error) {
      console.warn('[SkillMarketplace] content fetch failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch skill content',
      };
    }
  });

  // MCP Server IPC handlers
  ipcMain.handle(McpIpc.List, () => {
    try {
      ensureBuiltInMcpDefaultsDisabled();
      const servers = getMcpStore().listServers();
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      };
    }
  });

  ipcMain.handle(
    McpIpc.Create,
    async (
      _event,
      data: {
        name: string;
        description: string;
        transportType: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        isBuiltIn?: boolean;
        registryId?: string;
      },
    ) => {
      try {
        const validationError = await validateMcpServerConfig(data as McpServerFormData);
        if (validationError) {
          return { success: false, error: validationError };
        }

        getMcpStore().createServer(data as McpServerFormData);
        const servers = getMcpStore().listServers();
        // Trigger async MCP bridge refresh (don't await — let UI show DB result immediately)
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create MCP server',
        };
      }
    },
  );

  ipcMain.handle(
    McpIpc.Update,
    async (
      _event,
      id: string,
      data: {
        name?: string;
        description?: string;
        transportType?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        githubUrl?: string;
        registryId?: string;
      },
    ) => {
      try {
        const existing = getMcpStore().getServer(id);
        if (!existing) {
          return { success: false, error: 'MCP server not found' };
        }

        const merged: McpServerFormData = {
          name: data.name ?? existing.name,
          description: data.description ?? existing.description,
          transportType: (data.transportType ??
            existing.transportType) as McpServerFormData['transportType'],
          command: data.command !== undefined ? data.command : existing.command,
          args: data.args !== undefined ? data.args : existing.args,
          env: data.env !== undefined ? data.env : existing.env,
          url: data.url !== undefined ? data.url : existing.url,
          headers: data.headers !== undefined ? data.headers : existing.headers,
          isBuiltIn: existing.isBuiltIn,
          githubUrl: data.githubUrl !== undefined ? data.githubUrl : existing.githubUrl,
          registryId: data.registryId !== undefined ? data.registryId : existing.registryId,
        };

        const validationError = await validateMcpServerConfig(merged);
        if (validationError) {
          return { success: false, error: validationError };
        }

        getMcpStore().updateServer(id, data as Partial<McpServerFormData>);
        const servers = getMcpStore().listServers();
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update MCP server',
        };
      }
    },
  );

  ipcMain.handle(McpIpc.TestConnection, async (_event, data: McpServerFormData) => {
    try {
      const validationError = await validateMcpServerConfig(data);
      if (validationError) {
        return { success: false, error: validationError };
      }
      return await probeMcpConnection(data);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test MCP connection',
      };
    }
  });

  ipcMain.handle(McpIpc.Delete, async (_event, id: string) => {
    try {
      const existing = getMcpStore().getServer(id);
      if (!existing) {
        return { success: false, error: 'MCP server not found' };
      }
      if (existing.registryId === FEISHU_MCP_REGISTRY_ID) {
        try {
          await logoutFeishuCli();
        } catch (error) {
          console.warn('[Feishu] CLI logout failed while uninstalling the connector:', error);
        }
        removeFeishuSkills();
      }
      getMcpStore().deleteServer(id);
      // OAuth sessions are keyed by the registry id during authorization,
      // while the installed server row has its own random database id. Clear
      // both keys so uninstall actually unlinks this App's authorization.
      const oauthKeys = new Set([id, existing.registryId].filter(Boolean));
      for (const oauthKey of oauthKeys) {
        getStore().delete(`${MCP_OAUTH_STORE_PREFIX}${oauthKey}`);
      }
      const servers = getMcpStore().listServers();
      const refreshResult = await refreshMcpBridge();
      if (refreshResult.error) {
        console.error('[McpBridge] refresh after uninstall failed:', refreshResult.error);
      }
      return { success: true, servers, refreshError: refreshResult.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      };
    }
  });

  ipcMain.handle(McpIpc.SetEnabled, async (_event, options: { id: string; enabled: boolean }) => {
    try {
      if (options.enabled) {
        const existing = getMcpStore().getServer(options.id);
        if (!existing) {
          return { success: false, error: 'MCP server not found' };
        }
        if (existing.registryId !== FEISHU_MCP_REGISTRY_ID) {
          const validationError = await validateStoredMcpServerConfig(existing);
          if (validationError) {
            return { success: false, error: validationError };
          }
          // Enabling must remain responsive. refreshMcpBridge() immediately
          // follows this write and performs the single authoritative OAuth
          // refresh plus MCP initialization. Doing it here as a synchronous
          // probe duplicated that network work and blocked the switch.
        }
      }

      getMcpStore().setEnabled(options.id, options.enabled);
      const servers = getMcpStore().listServers();
      refreshMcpBridge().catch(err => console.error('[McpBridge] background refresh error:', err));
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      };
    }
  });

  ipcMain.handle(McpIpc.FetchMarketplace, async () => {
    try {
      return {
        success: true,
        data: loadBundledMcpMarketplace(app.getAppPath(), process.resourcesPath),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load bundled MCP marketplace',
      };
    }
  });

  ipcMain.handle(McpIpc.LoadIcon, async (_event, iconPath: string) => {
    try {
      const marketplace = loadBundledMcpMarketplace(app.getAppPath(), process.resourcesPath);
      if (
        !marketplace.servers.some(server => (server as { iconPath?: string }).iconPath === iconPath)
      ) {
        return { success: false, error: 'MCP icon is not registered' };
      }
      const roots = [
        path.join(process.resourcesPath, 'MCPs'),
        path.join(app.getAppPath(), 'MCPs'),
        path.join(process.cwd(), 'MCPs'),
      ];
      for (const root of roots) {
        const filePath = path.resolve(root, iconPath);
        if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) continue;
        const extension = path.extname(filePath).toLowerCase();
        const mimeType =
          extension === '.png'
            ? 'image/png'
            : extension === '.jpg' || extension === '.jpeg'
              ? 'image/jpeg'
              : extension === '.svg'
                ? 'image/svg+xml'
                : null;
        if (!mimeType) return { success: false, error: 'Unsupported MCP icon format' };
        return {
          success: true,
          data: `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`,
        };
      }
      return { success: false, error: 'MCP icon was not found' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load MCP icon',
      };
    }
  });

  ipcMain.handle(McpIpc.CancelAuthorize, (_event, requestId: string) => {
    activeMcpAuthorizations.get(requestId)?.abort();
    return { success: true };
  });

  ipcMain.handle(McpIpc.GetFeishuCliStatus, () => ({
    success: true,
    installed: Boolean(getLocalFeishuCliCommand()),
  }));

  ipcMain.handle(McpIpc.PrepareFeishuCli, async () => {
    try {
      await prepareFeishuCli();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install Feishu CLI',
      };
    }
  });

  ipcMain.handle(
    McpIpc.Authorize,
    async (_event, rawData: McpServerFormData & { authorizationRequestId?: string }) => {
      const { authorizationRequestId, ...data } = rawData;
      const cancellation = authorizationRequestId ? new AbortController() : null;
      if (authorizationRequestId && cancellation) {
        activeMcpAuthorizations.set(authorizationRequestId, cancellation);
      }
      const ensureNotCancelled = () => {
        if (cancellation?.signal.aborted) throw new Error('MCP authorization was cancelled');
      };
      try {
        ensureNotCancelled();
        if (data.registryId === FEISHU_MCP_REGISTRY_ID) {
          await authorizeFeishuCli(cancellation?.signal);
          ensureNotCancelled();
          installFeishuSkills();
          ensureNotCancelled();
          const existingFeishu = getMcpStore()
            .listServers()
            .find(server => server.registryId === FEISHU_MCP_REGISTRY_ID);
          if (!existingFeishu) {
            getMcpStore().createServer({
              name: data.name,
              description: data.description,
              transportType: 'stdio',
              command: 'lark-cli',
              isBuiltIn: true,
              registryId: FEISHU_MCP_REGISTRY_ID,
            });
          }
          const servers = getMcpStore().listServers();
          const refreshResult = await refreshMcpBridge();
          if (refreshResult.error) {
            console.error('[McpBridge] Feishu refresh error:', refreshResult.error);
          }
          return { success: true, servers, refreshError: refreshResult.error };
        }
        const validationError = await validateMcpServerConfig(data);
        if (validationError) return { success: false, error: validationError };
        if (!data.registryId || !data.url)
          return { success: false, error: 'Official MCP configuration is incomplete' };

        const accessToken = await new McpOAuthManager(getStore()).authorize(
          data.registryId,
          data.url,
          cancellation?.signal,
        );
        ensureNotCancelled();
        if (!accessToken)
          return { success: false, error: 'OAuth authorization did not return an access token' };

        getMcpStore().createServer({
          ...data,
          isBuiltIn: true,
          headers: { ...data.headers, Authorization: `Bearer ${accessToken}` },
        });
        const servers = getMcpStore().listServers();
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to authorize MCP server',
        };
      } finally {
        if (authorizationRequestId) activeMcpAuthorizations.delete(authorizationRequestId);
      }
    },
  );

  // Explicit bridge refresh — renderer can await this for loading state
  ipcMain.handle(McpIpc.RefreshBridge, async () => {
    try {
      const result = await refreshMcpBridge();
      return { success: true, tools: result.tools, error: result.error };
    } catch (error) {
      return {
        success: false,
        tools: 0,
        error: error instanceof Error ? error.message : 'Failed to refresh MCP bridge',
      };
    }
  });

  ipcMain.handle(WorkspaceIpc.List, async () => {
    try {
      const store = getCoworkStore();
      let workspaces = store.listWorkspaces();
      for (const workspace of workspaces) {
        if (isDefaultConversationWorkspacePath(workspace.path)) {
          if (workspace.isHidden) store.setWorkspaceHidden(workspace.id, false);
          continue;
        }
        if (!workspace.isHidden && isInternalWorkspacePath(workspace.path)) {
          store.setWorkspaceHidden(workspace.id, true);
        }
      }
      workspaces = store.listWorkspaces();
      if (getStore().get<boolean>(WorkspaceStoreKey.DefaultConversationInitialized) !== true) {
        const defaultWorkspacePath = getDefaultConversationWorkspacePath();
        await fs.promises.mkdir(defaultWorkspacePath, { recursive: true });
        const defaultWorkspace = store.ensureWorkspace(defaultWorkspacePath);
        store.setWorkspaceHidden(defaultWorkspace.id, false);
        getStore().set(WorkspaceStoreKey.DefaultConversationInitialized, true);
        workspaces = store.listWorkspaces();
      }
      return { success: true, workspaces };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list workspaces',
      };
    }
  });

  ipcMain.handle(
    WorkspaceIpc.Ensure,
    async (_event, rawOptions: { path?: string; name?: string; isHidden?: boolean }) => {
      try {
        const workspacePath = rawOptions?.path?.trim();
        if (!workspacePath) return { success: false, error: 'Workspace path is required' };
        const workspace = getCoworkStore().ensureWorkspace(
          workspacePath,
          rawOptions.name,
          rawOptions.isHidden === true,
        );
        return { success: true, workspace };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ensure workspace',
        };
      }
    },
  );

  ipcMain.handle(WorkspaceIpc.Rename, async (_event, id: string, name: string) => {
    try {
      const normalizedName = name.trim();
      if (
        !normalizedName ||
        /[\\/:*?"<>|]/.test(normalizedName) ||
        normalizedName === '.' ||
        normalizedName === '..'
      ) {
        return { success: false, error: 'Invalid project name' };
      }

      const coworkStore = getCoworkStore();
      const workspace = coworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be renamed' };
      }
      if (!fs.existsSync(workspace.path) || !fs.statSync(workspace.path).isDirectory()) {
        return { success: false, error: 'Project directory no longer exists' };
      }

      const targetPath = path.join(path.dirname(workspace.path), normalizedName);
      const pathsMatch =
        process.platform === 'win32'
          ? path.resolve(targetPath).toLowerCase() === path.resolve(workspace.path).toLowerCase()
          : path.resolve(targetPath) === path.resolve(workspace.path);
      if (!pathsMatch && fs.existsSync(targetPath)) {
        return { success: false, error: 'A directory with this name already exists' };
      }

      fs.renameSync(workspace.path, targetPath);
      try {
        const renamedWorkspace = coworkStore.relocateWorkspace(id, targetPath, normalizedName);
        if (!renamedWorkspace) throw new Error('Workspace not found');
        return { success: true, workspace: renamedWorkspace };
      } catch (error) {
        fs.renameSync(targetPath, workspace.path);
        throw error;
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename workspace',
      };
    }
  });

  ipcMain.handle(WorkspaceIpc.Delete, async (_event, id: string) => {
    try {
      if (typeof id !== 'string' || !id.trim()) {
        return { success: false, error: 'Workspace id is required' };
      }
      const coworkStore = getCoworkStore();
      const workspace = coworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be removed' };
      }
      const deletedSessionIds = coworkStore.deleteWorkspace(id);
      console.log(
        `[CoworkStore] removed a workspace along with ${deletedSessionIds.length} session(s)`,
      );
      return { success: true, deletedSessionIds };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove workspace',
      };
    }
  });

  // Project working-directory helpers
  const getDefaultProjectBaseDir = () =>
    path.join(app.getPath('documents'), 'ZhiYuanAgent', 'Workspaces');
  const getUnmanagedWorkspaceBaseDir = () =>
    path.join(app.getPath('userData'), 'unmanaged-workspaces');
  const isUuidDirectoryName = (directoryName: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(directoryName);
  const isLegacyUnmanagedWorkspacePath = (candidatePath: string): boolean => {
    const relativePath = path.relative(getDefaultProjectBaseDir(), candidatePath);
    return !relativePath.includes(path.sep) && isUuidDirectoryName(relativePath);
  };
  const isUnmanagedWorkspacePath = (candidatePath: string): boolean => {
    const relativePath = path.relative(getUnmanagedWorkspaceBaseDir(), candidatePath);
    return (
      Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    );
  };
  const isInternalWorkspacePath = (candidatePath: string): boolean =>
    isLegacyUnmanagedWorkspacePath(candidatePath) || isUnmanagedWorkspacePath(candidatePath);

  ipcMain.handle(ProjectIpc.GetDefaultBaseDir, async () => {
    try {
      return { success: true, path: getDefaultProjectBaseDir() };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to resolve default project path',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateDirectory, async (_event, rawOptions: unknown) => {
    try {
      const options = ProjectCreateDirectorySchema.input.parse(rawOptions);
      const name = options.name.trim();
      if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
        return { success: false, path: null, code: 'invalid-name', error: 'Invalid project name' };
      }
      const baseDir = options.baseDir?.trim() || getDefaultProjectBaseDir();
      const targetPath = path.join(baseDir, name);
      if (fs.existsSync(targetPath)) {
        return {
          success: false,
          path: null,
          code: 'already-exists',
          error: 'A directory with this name already exists',
        };
      }
      await fs.promises.mkdir(targetPath, { recursive: true });
      console.log('[Project] created project directory:', targetPath);
      return { success: true, path: targetPath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create project directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.EnsureScratchDir, async () => {
    try {
      const scratchDir = getDefaultConversationWorkspacePath();
      await fs.promises.mkdir(scratchDir, { recursive: true });
      return { success: true, path: scratchDir };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to ensure scratch directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateRandomWorkspace, async () => {
    try {
      const randomWorkspacePath = path.join(getUnmanagedWorkspaceBaseDir(), crypto.randomUUID());
      await fs.promises.mkdir(randomWorkspacePath, { recursive: true });
      return { success: true, path: randomWorkspacePath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create random workspace',
      };
    }
  });

  // Cowork IPC handlers
  ipcMain.handle(CoworkSessionIpc.Start, async (_event, rawOptions: unknown) => {
    const cid = generateCorrelationId();
    const log = createLogger('CoworkSession').withContext({ cid });
    const options = CoworkSessionStartSchema.input.parse(rawOptions);
    log.info('session start requested', {
      prompt: options.prompt.slice(0, 80),
      agentId: options.agentId,
      systemPromptLen: options.systemPrompt?.length ?? 0,
    });
    return runWithCorrelationId(cid, async () => {
      try {
        // Work sessions use Pi (SDK mode, instant availability). No need to wait
        // for channel delivery; that gate applies only to IM/Cron paths.
        const coworkStoreInstance = getCoworkStore();
        const config = coworkStoreInstance.getConfig();
        const selectedAgent = getAgentManager().getAgent(options.agentId || 'main');
        const fallbackExpertIds =
          selectedAgent &&
          (selectedAgent.source === CoworkSessionExpertSource.Package ||
            selectedAgent.source === CoworkSessionExpertSource.Member)
            ? [selectedAgent.id]
            : [];
        const expertSnapshots = resolveSessionExpertSnapshots(
          options.expertIds ?? fallbackExpertIds,
        );
        // The renderer already includes the selected non-expert agent prompt when
        // present. Treat that request value as the source prompt instead of
        // appending the same agent prompt again in the main process.
        const basePrompt =
          options.systemPrompt ?? selectedAgent?.systemPrompt ?? config.systemPrompt;
        const systemPrompt = composeCoworkSystemPrompt({
          basePrompt,
          expertSnapshots,
          language: resolveCoworkPromptLanguage(),
        });
        const workspace = options.workspaceId
          ? coworkStoreInstance.getWorkspace(options.workspaceId)
          : null;
        const selectedTaskDirectory = resolveSessionWorkingDirectory({
          cwd: options.cwd || workspace?.path,
        });

        if (!selectedTaskDirectory) {
          return {
            success: false,
            error: 'Please select a task folder before submitting.',
          };
        }
        const selectedWorkspace =
          workspace || coworkStoreInstance.ensureWorkspace(selectedTaskDirectory);

        const fallbackTitle = buildSessionTitleFromInput(
          options.prompt,
          t('coworkDefaultSessionTitle'),
        );
        const title = options.title?.trim() || fallbackTitle;
        const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedTaskDirectory);

        const session = coworkStoreInstance.createSession(
          title,
          taskWorkingDirectory,
          systemPrompt,
          config.executionMode || 'local',
          options.activeSkillIds || [],
          options.agentId || 'main',
          options.modelOverride || '',
          options.mode ?? CoworkSessionMode.Work,
          undefined,
          selectedWorkspace.id,
          expertSnapshots,
        );

        if (options.modelOverride) {
          console.log(
            '[Cowork:StartSession] session created with modelOverride:',
            session.id,
            options.modelOverride,
          );
        }

        // Update session status to 'running' before starting async task
        // This ensures the frontend receives the correct status immediately
        coworkStoreInstance.updateSession(session.id, { status: 'running' });

        // Build metadata, include imageAttachments if present
        const messageMetadata: Record<string, unknown> = {};
        if (expertSnapshots.length > 0) {
          messageMetadata.experts = expertSnapshots.map(expert => ({
            expertId: expert.expertId,
            expertName: expert.expertName,
            presetId: expert.packageId,
          }));
        }
        if (options.activeSkillIds?.length) {
          messageMetadata.skillIds = options.activeSkillIds;
        }
        if (options.imageAttachments?.length) {
          console.log('[Cowork:StartSession] imageAttachments received via IPC:', {
            count: options.imageAttachments.length,
            details: options.imageAttachments.map(img => ({
              name: img.name,
              mimeType: img.mimeType,
              base64Length: img.base64Data?.length ?? 0,
            })),
          });
          messageMetadata.imageAttachments = options.imageAttachments;
        }
        if (options.fileAttachments?.length) {
          messageMetadata.fileAttachments = options.fileAttachments;
        }
        coworkStoreInstance.addMessage(session.id, {
          type: 'user',
          content: options.prompt,
          metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
        });
        coworkStoreInstance.touchWorkspace(session.workspaceId);

        // Update session status to 'running' before starting async task
        // This ensures the frontend receives the correct status immediately
        coworkStoreInstance.updateSession(session.id, { status: 'running' });

        // Start the session asynchronously (skip initial user message since we already added it)
        const runtime = getPiRuntimeAdapter();
        const runtimeSkillIds = [
          ...new Set([
            ...(options.activeSkillIds || []),
            ...expertSnapshots.flatMap(expert => expert.skillIds),
          ]),
        ];
        runtime
          .startSession(session.id, options.prompt, {
            skipInitialUserMessage: true,
            systemPrompt,
            skillIds: runtimeSkillIds,
            workspaceRoot: taskWorkingDirectory,
            confirmationMode: 'modal',
            sessionMode: options.mode ?? CoworkSessionMode.Work,
            goalMode: options.goalMode,
            productionLoopMode: options.productionLoopMode,
            approvalMode:
              options.permissionMode === CoworkPermissionMode.AllowAll
                ? WorkbenchApprovalMode.AllowAll
                : WorkbenchApprovalMode.Ask,
            imageAttachments: options.imageAttachments,
            fileAttachments: options.fileAttachments,
            agentId: options.agentId,
            expertIds: expertSnapshots.map(expert => expert.expertId),
            modelOverride: options.modelOverride,
          })
          .catch(error => {
            console.error('[Cowork] session error:', error);
            try {
              // The engine router already emits an 'error' event (handled at line ~990)
              // which sends cowork:stream:error to the renderer. Only send here if the
              // session hasn't been marked as error yet, to avoid duplicate messages.
              const existing = coworkStoreInstance.getSession(session.id);
              if (existing?.status === 'error') return;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const windows = BrowserWindow.getAllWindows();
              windows.forEach(win => {
                if (win.isDestroyed()) return;
                win.webContents.send(CoworkStreamIpc.Error, {
                  sessionId: session.id,
                  error: classifyCoworkError(errorMessage),
                });
              });
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
            }
          });

        const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
          ...session,
          status: 'running' as const,
        };
        return { success: true, session: sessionWithMessages };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start session',
        };
      }
    });
  });

  ipcMain.handle(CoworkSessionIpc.Continue, async (_event, rawOptions: unknown) => {
    try {
      const options = CoworkSessionContinueSchema.input.parse(rawOptions);
      // Work sessions use Pi (SDK mode, instant availability).
      const runtime = getPiRuntimeAdapter();
      const store = getCoworkStore();
      let existingSession = store.getSession(options.sessionId);
      if (existingSession) {
        const previousExpertSnapshots = existingSession.experts;
        const expertSnapshots =
          options.expertIds === undefined ||
          haveSameExpertIds(previousExpertSnapshots, options.expertIds)
            ? previousExpertSnapshots.slice(0, 1)
            : resolveSessionExpertSnapshots(options.expertIds);
        const nextSystemPrompt = composeCoworkSystemPrompt({
          basePrompt: existingSession.systemPrompt || options.systemPrompt,
          expertSnapshots,
          previousExpertSnapshots,
          language: resolveCoworkPromptLanguage(),
        });
        const expertsChanged = !haveSameExpertSnapshots(previousExpertSnapshots, expertSnapshots);
        if (expertsChanged) {
          store.replaceSessionExperts(options.sessionId, expertSnapshots);
        }
        if (nextSystemPrompt !== existingSession.systemPrompt) {
          store.updateSession(options.sessionId, { systemPrompt: nextSystemPrompt });
        }
        if (expertsChanged || nextSystemPrompt !== existingSession.systemPrompt) {
          existingSession = store.getSession(options.sessionId);
        }
      }
      if (options.imageAttachments?.length) {
        console.log('[Cowork:ContinueSession] imageAttachments received via IPC:', {
          sessionId: options.sessionId,
          count: options.imageAttachments.length,
          details: options.imageAttachments.map(img => ({
            name: img.name,
            mimeType: img.mimeType,
            base64Length: img.base64Data?.length ?? 0,
          })),
        });
      }

      const continuationSkillState = resolveCoworkContinuationSkillState({
        activeSkillIds: options.activeSkillIds,
        savedSkillIds: existingSession?.activeSkillIds,
        expertSkillIds: (existingSession?.experts || []).flatMap(expert => expert.skillIds),
      });

      // Persist explicit selections, including [] when the user clears session skills.
      if (continuationSkillState.sessionSkillIds !== undefined) {
        try {
          store.updateSession(options.sessionId, {
            activeSkillIds: continuationSkillState.sessionSkillIds,
          });
        } catch (error) {
          console.error('[Cowork:ContinueSession] failed to persist activeSkillIds:', error);
        }
      }

      const runtimeSkillIds = continuationSkillState.runtimeSkillIds;

      const runtimeSystemPrompt = existingSession
        ? existingSession.systemPrompt
        : composeCoworkSystemPrompt({
            basePrompt: options.systemPrompt,
            language: resolveCoworkPromptLanguage(),
          });

      if (existingSession && options.prompt.trim()) {
        store.touchWorkspace(existingSession.workspaceId);
      }

      runtime
        .continueSession(options.sessionId, options.prompt, {
          systemPrompt: runtimeSystemPrompt,
          skillIds: runtimeSkillIds,
          sessionMode:
            existingSession?.mode === CoworkSessionMode.Chat
              ? CoworkSessionMode.Chat
              : CoworkSessionMode.Work,
          goalMode: options.goalMode,
          productionLoopMode: options.productionLoopMode,
          imageAttachments: options.imageAttachments,
          fileAttachments: options.fileAttachments,
          workspaceRoot: existingSession?.cwd,
          agentId: existingSession?.agentId,
          expertIds: existingSession?.experts.map(expert => expert.expertId),
          modelOverride: existingSession?.modelOverride,
          approvalMode:
            options.permissionMode === CoworkPermissionMode.AllowAll
              ? WorkbenchApprovalMode.AllowAll
              : WorkbenchApprovalMode.Ask,
        })
        .catch(error => {
          console.error('[Cowork] continue error:', error);
          try {
            // The engine router already emits an 'error' event (handled at line ~990)
            // which sends cowork:stream:error to the renderer. Only send here if the
            // session hasn't been marked as error yet, to avoid duplicate messages.
            const existing = getCoworkStore().getSession(options.sessionId);
            if (existing?.status === 'error') return;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const windows = BrowserWindow.getAllWindows();
            windows.forEach(win => {
              if (win.isDestroyed()) return;
              win.webContents.send(CoworkStreamIpc.Error, {
                sessionId: options.sessionId,
                error: classifyCoworkError(errorMessage),
              });
            });
          } catch (handlerError) {
            console.error('[Cowork] failed to send error notification to renderer:', handlerError);
          }
        });

      const session = getCoworkStore().getSession(options.sessionId);
      return { success: true, session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to continue session',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.List, async (_event, rawInput: unknown) => {
    try {
      const sessionId = CoworkQueueSessionSchema.parse(rawInput);
      return { success: true, items: getPiRuntimeAdapter().listPendingMessages(sessionId) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list pending messages',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Enqueue, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueEnqueueSchema.parse(rawInput);
      return getPiRuntimeAdapter().enqueuePendingMessage(
        input.sessionId,
        input.text,
        input.imageAttachments,
        input.fileAttachments,
        input.skillIds,
        input.skillPrompt,
        input.productionLoopMode,
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enqueue pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Update, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueUpdateSchema.parse(rawInput);
      return getPiRuntimeAdapter().updatePendingMessage(input.sessionId, input.itemId, input.text);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Delete, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return getPiRuntimeAdapter().deletePendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Steer, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().steerPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to steer pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.FollowUp, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().followUpPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send follow-up message',
      };
    }
  });

  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runtime = getPiRuntimeAdapter();
      runtime.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop session',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:save',
    async (
      _event,
      session: {
        id: string;
        title: string;
        status: string;
        mode: 'work' | 'chat';
        cwd: string;
        systemPrompt: string;
        modelOverride: string;
        executionMode: string;
        activeSkillIds: string[];
        agentId: string;
        messages: Array<{
          id: string;
          type: string;
          content: string;
          timestamp: number;
          metadata?: Record<string, unknown>;
        }>;
      },
    ) => {
      try {
        const existing = coworkStore.getSession(session.id);
        if (existing) {
          // Session already exists — update status and sync new messages
          coworkStore.updateSession(session.id, { status: session.status as CoworkSessionStatus });
          for (const msg of session.messages || []) {
            coworkStore.upsertMessage(session.id, {
              id: msg.id,
              type: msg.type as CoworkMessageType,
              content: msg.content,
              timestamp: msg.timestamp,
              metadata: msg.metadata,
            });
          }
          const updated = coworkStore.getSession(session.id);
          return { success: true, session: updated };
        }
        // Create new session in SQLite
        const newSession = coworkStore.createSession(
          session.title,
          session.cwd,
          session.systemPrompt || '',
          (session.executionMode as CoworkExecutionMode) || 'local',
          session.activeSkillIds || [],
          session.agentId || 'main',
          session.modelOverride || '',
          session.mode || 'work',
          session.id,
        );
        // Save messages
        for (const msg of session.messages || []) {
          coworkStore.upsertMessage(newSession.id, {
            id: msg.id,
            type: msg.type as CoworkMessageType,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: msg.metadata,
          });
        }
        // Update status
        coworkStore.updateSession(newSession.id, { status: session.status as CoworkSessionStatus });
        const saved = coworkStore.getSession(newSession.id);
        return { success: true, session: saved };
      } catch (error) {
        console.error('[Cowork] Failed to save session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  );

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      // Purge runtime state first so late events cannot write to the session
      // after the DB row is removed.
      getPiRuntimeAdapter().onSessionDeleted(sessionId);
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      // Clean up IM session mapping so that new channel messages
      // create a fresh session instead of referencing a deleted one.
      try {
        getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      };
    }
  });

  ipcMain.handle('cowork:session:deleteBatch', async (_event, sessionIds: string[]) => {
    try {
      const runtime = getPiRuntimeAdapter();
      // Purge runtime state before deleting DB rows so late events cannot
      // recreate or write to sessions that are being removed.
      for (const sessionId of sessionIds) {
        runtime.onSessionDeleted(sessionId);
      }
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSessions(sessionIds);
      for (const sessionId of sessionIds) {
        try {
          getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
        } catch {
          // IM store may not be initialised yet; safe to ignore.
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:pin',
    async (_event, options: { sessionId: string; pinned: boolean }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        const pinOrder = coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
        return { success: true, pinOrder };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update session pin',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:rename',
    async (_event, options: { sessionId: string; title: string }) => {
      try {
        const title = options.title.trim();
        if (!title) {
          return { success: false, error: 'Title is required' };
        }
        const coworkStoreInstance = getCoworkStore();
        coworkStoreInstance.updateSession(options.sessionId, { title });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to rename session',
        };
      }
    },
  );

  ipcMain.handle(CoworkSessionIpc.UpdateModel, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkSessionUpdateModelSchema.input.parse(rawInput);
      const store = getCoworkStore();
      const existing = store.getSession(input.sessionId, 0);
      if (!existing) {
        return { success: false, error: 'Session not found' };
      }
      store.updateSession(
        input.sessionId,
        { modelOverride: input.modelOverride },
        { touchUpdatedAt: false },
      );
      return { success: true, session: store.getSession(input.sessionId, 0) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update session model',
      };
    }
  });

  ipcMain.handle(CoworkSessionIpc.Get, async (_event, sessionId: string) => {
    try {
      const store = getCoworkStore();
      // The renderer virtualizes turns, so it needs the complete local data
      // model up front to expose the full scroll range without mounting the
      // entire transcript in the DOM.
      const session = store.getSession(sessionId, null);
      if (!session) return { success: true, session: null };

      const reconciledSession = reconcileWorkSessionRuntimeState(
        session,
        getPiRuntimeAdapter().isSessionRunning(sessionId),
      );
      if (reconciledSession.status !== session.status) {
        store.updateSession(sessionId, { status: reconciledSession.status });
      }
      return { success: true, session: reconciledSession };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get session',
      };
    }
  });

  ipcMain.handle('cowork:session:remoteManaged', async (_event, sessionId: string) => {
    try {
      const mapping = getIMGatewayManager()
        ?.getIMStore()
        ?.getSessionMappingByCoworkSessionId(sessionId);
      return { success: true, remoteManaged: !!mapping };
    } catch (error) {
      return {
        success: false,
        remoteManaged: false,
        error: error instanceof Error ? error.message : 'Failed to check remote managed session',
      };
    }
  });

  ipcMain.handle(
    CoworkSessionIpc.List,
    async (
      _event,
      options?: {
        limit?: number;
        offset?: number;
        agentId?: string;
        workspaceId?: string;
        mode?: CoworkSessionMode;
        sources?: CoworkSessionSource[];
      },
    ) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const workspaceId = options?.workspaceId;
        const mode = options?.mode;
        const sources = options?.sources;
        const store = getCoworkStore();
        const sessions = store
          .listSessions(limit, offset, agentId, workspaceId, mode, sources)
          .map(session => {
            const reconciledSession = reconcileWorkSessionRuntimeState(
              session,
              getPiRuntimeAdapter().isSessionRunning(session.id),
            );
            if (reconciledSession.status !== session.status) {
              store.updateSession(session.id, { status: reconciledSession.status });
            }
            return reconciledSession;
          });
        const total = store.countSessions(agentId, workspaceId, mode, sources);
        return { success: true, sessions, hasMore: offset + sessions.length < total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkSessionIpc.GetMessages,
    async (_event, options: { sessionId: string; limit?: number; offset?: number }) => {
      try {
        const { sessionId, limit = COWORK_MESSAGE_PAGE_SIZE, offset = 0 } = options;
        const store = getCoworkStore();
        const total = store.countSessionMessages(sessionId);
        const messages = store.getPagedSessionMessages(sessionId, limit, offset);
        return { success: true, messages, offset, total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session messages',
        };
      }
    },
  );

  // ========== Agent IPC Handlers ==========

  ipcMain.handle(AgentIpcChannel.List, async () => {
    try {
      const agents = getAgentManager().listAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Get, async (_event, id: string) => {
    try {
      const agent = getAgentManager().getAgent(id);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get agent',
      };
    }
  });

  ipcMain.handle(
    AgentIpcChannel.Create,
    async (_event, request: import('./coworkStore').CreateAgentRequest) => {
      try {
        const agent = getAgentManager().createAgent(request, resolveDefaultAgentModelRef());
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create agent',
        };
      }
    },
  );

  ipcMain.handle(
    AgentIpcChannel.Update,
    async (_event, id: string, updates: import('./coworkStore').UpdateAgentRequest) => {
      try {
        const agent = getAgentManager().updateAgent(id, updates);
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update agent',
        };
      }
    },
  );

  ipcMain.handle(AgentIpcChannel.Delete, async (_event, id: string) => {
    try {
      const result = getAgentManager().deleteAgent(id);

      // Cascade delete all Cowork sessions belonging to the deleted agent
      const coworkStore = getCoworkStore();
      const deletedSessionIds = coworkStore.deleteSessionsByAgentId(id);

      // Clean up IM session mappings for deleted sessions
      if (deletedSessionIds.length > 0) {
        try {
          const imStore = getIMGatewayManager()?.getIMStore();
          if (imStore) {
            for (const sessionId of deletedSessionIds) {
              imStore.deleteSessionMappingByCoworkSessionId(sessionId);
            }
          }
        } catch {
          // IM store may not be initialised yet; safe to ignore.
        }

        // Notify renderer to refresh session lists
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win.isDestroyed()) continue;
          win.webContents.send(CoworkStreamIpc.SessionsChanged, { agentId: id, deletedSessionIds });
        }
      }

      return { success: true, deleted: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.ImportExpertPackage, async (_event, expertDir: string) => {
    try {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
      const registerExpertModule = require(
        path.join(bundledSkillsRoot, 'zhiyuan-expert-manager', 'scripts', 'register_expert'),
      ) as {
        parseExpertPackage: (...args: unknown[]) => {
          pluginJson: { name?: unknown; version?: unknown; expertType?: unknown };
          requests: Array<{
            id: string;
            name: string;
            description: string;
            systemPrompt: string;
            identity: string;
            icon: string;
            skillIds?: string[];
          }>;
          piSyncedFiles?: string[];
        };
        upsertExpertRegistry: (options: {
          registryPath: string;
          entry: Record<string, unknown>;
          skipIfWithin?: string[];
        }) => void;
      };
      const { parseExpertPackage, upsertExpertRegistry } = registerExpertModule;
      const dbPath = path.join(app.getPath('userData'), DB_FILENAME);
      const agentManager = getAgentManager();

      // Re-importing an installed preset upgrades it in place: existing
      // agents are updated, packaged skills are refreshed, and the stale
      // preset registry entry is replaced.
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(expertDir, 'plugin.json'), 'utf-8'),
      ) as { name?: unknown; version?: unknown; expertType?: unknown };
      const isUpgrade =
        typeof packageJson.name === 'string' &&
        agentManager.listAgents().some(agent => agent.presetId === packageJson.name);
      const { pluginJson, requests, piSyncedFiles } = parseExpertPackage(expertDir, {
        dbPath,
        update: isUpgrade,
      });

      const defaultModel = resolveDefaultAgentModelRef();
      const agentIds: string[] = [];

      for (const request of requests) {
        // Re-importing an installed preset upgrades it in place instead of
        // failing on the duplicate name — preset updates (system prompt,
        // skills, workflow) must reach already-installed experts.
        const existing = agentManager.getAgent(request.id);
        if (existing) {
          agentManager.updateAgent(existing.id, {
            name: request.name,
            description: request.description,
            systemPrompt: request.systemPrompt,
            identity: request.identity,
            icon: request.icon,
            skillIds: request.skillIds ?? [],
          });
          agentIds.push(existing.id);
        } else {
          const agent = agentManager.createAgent(request, defaultModel);
          agentIds.push(agent.id);
        }
      }

      // Bundled presets are file-sourced (方案A): they never enter the
      // registry. The single registry service (register_expert.js) enforces
      // containment server-side, drops stale bundled records idempotently,
      // and only records user-imported packages.
      const packagesDir = path.join(app.getPath('userData'), 'expert-packages');
      fs.mkdirSync(packagesDir, { recursive: true });
      upsertExpertRegistry({
        registryPath: path.join(packagesDir, 'registry.json'),
        entry: {
          name: pluginJson.name,
          version: pluginJson.version,
          expertType: pluginJson.expertType,
          path: expertDir,
          agentIds,
          piSyncedFiles: piSyncedFiles || [],
          createdAt: new Date().toISOString(),
        },
        skipIfWithin: [bundledSkillsRoot],
      });

      return { success: true, agentIds, expertType: pluginJson.expertType, name: pluginJson.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import expert package',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.GetPresetExperts, async () => {
    try {
      const bundledSkillsRoot = getSkillManager().getBundledSkillsRoot();
      return { experts: listPresetExperts(bundledSkillsRoot) };
    } catch (error) {
      return {
        experts: [],
        error: error instanceof Error ? error.message : 'Failed to list preset experts',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:exportResultImage',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
        defaultFileName?: string;
      },
    ) => {
      try {
        const { rect, defaultFileName } = options || {};
        const captureRect = normalizeCaptureRect(rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        return savePngWithDialog(event.sender, image.toPNG(), defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:captureImageChunk',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
      },
    ) => {
      try {
        const captureRect = normalizeCaptureRect(options?.rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        const pngBuffer = image.toPNG();

        return {
          success: true,
          width: captureRect.width,
          height: captureRect.height,
          pngBase64: pngBuffer.toString('base64'),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:saveResultImage',
    async (
      event,
      options: {
        pngBase64: string;
        defaultFileName?: string;
      },
    ) => {
      try {
        const base64 = typeof options?.pngBase64 === 'string' ? options.pngBase64.trim() : '';
        if (!base64) {
          return { success: false, error: 'Image data is required' };
        }

        const pngBuffer = Buffer.from(base64, 'base64');
        if (pngBuffer.length <= 0) {
          return { success: false, error: 'Invalid image data' };
        }

        return savePngWithDialog(event.sender, pngBuffer, options?.defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:exportText',
    async (
      event,
      options: {
        content: string;
        defaultFileName?: string;
        fileExtension?: string;
      },
    ) => {
      try {
        const content = typeof options?.content === 'string' ? options.content : '';
        if (!content) {
          return { success: false, error: 'Export content is empty' };
        }

        const ext = options?.fileExtension || 'md';
        const filterName = ext === 'json' ? 'JSON' : 'Markdown';
        const defaultName = options?.defaultFileName || `session-export.${ext}`;
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        const saveOptions = {
          title: 'Export Session',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters: [{ name: filterName, extensions: [ext] }],
        };
        const saveResult = ownerWindow
          ? await dialog.showSaveDialog(ownerWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, canceled: true };
        }

        await fs.promises.writeFile(saveResult.filePath, content, 'utf-8');
        return { success: true, canceled: false, path: saveResult.filePath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkPermissionIpc.Respond,
    async (
      _event,
      options: {
        requestId: string;
        result: PermissionResult;
      },
    ) => {
      try {
        const runtime = getPiRuntimeAdapter();
        runtime.respondToPermission(options.requestId, options.result);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to respond to permission',
        };
      }
    },
  );

  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      };
    }
  });

  ipcMain.handle('cowork:bootstrap:read', async (_event, filename: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspace();
      const content = readBootstrapFile(mainWorkspace, filename);
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Failed to read bootstrap file',
      };
    }
  });
  ipcMain.handle('cowork:bootstrap:write', async (_event, filename: string, content: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspace();
      writeBootstrapFile(mainWorkspace, filename, content);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write bootstrap file',
      };
    }
  });

  const VALID_EMBEDDING_PROVIDERS = [
    'local',
    'openai',
    'gemini',
    'voyage',
    'mistral',
    'ollama',
  ] as const;

  function normalizeEmbeddingConfig(config: {
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) {
    return {
      embeddingEnabled:
        typeof config.embeddingEnabled === 'boolean' ? config.embeddingEnabled : undefined,
      embeddingProvider:
        typeof config.embeddingProvider === 'string' &&
        (VALID_EMBEDDING_PROVIDERS as readonly string[]).includes(config.embeddingProvider)
          ? config.embeddingProvider
          : undefined,
      embeddingModel:
        typeof config.embeddingModel === 'string' ? config.embeddingModel.trim() : undefined,
      embeddingLocalModelPath:
        typeof config.embeddingLocalModelPath === 'string'
          ? config.embeddingLocalModelPath.trim()
          : undefined,
      embeddingVectorWeight:
        typeof config.embeddingVectorWeight === 'number' &&
        Number.isFinite(config.embeddingVectorWeight)
          ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
          : undefined,
      embeddingRemoteBaseUrl:
        typeof config.embeddingRemoteBaseUrl === 'string'
          ? config.embeddingRemoteBaseUrl.trim()
          : undefined,
      embeddingRemoteApiKey:
        typeof config.embeddingRemoteApiKey === 'string'
          ? config.embeddingRemoteApiKey.trim()
          : undefined,
    };
  }

  ipcMain.handle(
    'cowork:config:set',
    async (
      _event,
      config: {
        workingDirectory?: string;
        executionMode?: 'auto' | 'local' | 'sandbox';
        permissionMode?: CoworkPermissionMode;
        permissionModeBySession?: Record<string, CoworkPermissionMode>;
        embeddingEnabled?: boolean;
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingLocalModelPath?: string;
        embeddingVectorWeight?: number;
        embeddingRemoteBaseUrl?: string;
        embeddingRemoteApiKey?: string;
      },
    ) => {
      try {
        const normalizedExecutionMode =
          config.executionMode && String(config.executionMode) === 'container'
            ? 'local'
            : config.executionMode;
        const normalizedPermissionMode =
          config.permissionMode === CoworkPermissionMode.Ask ||
          config.permissionMode === CoworkPermissionMode.AllowAll
            ? config.permissionMode
            : undefined;
        const normalizedPermissionModeBySession =
          config.permissionModeBySession && typeof config.permissionModeBySession === 'object'
            ? Object.fromEntries(
                Object.entries(config.permissionModeBySession).filter(
                  ([, value]) =>
                    value === CoworkPermissionMode.Ask || value === CoworkPermissionMode.AllowAll,
                ),
              )
            : undefined;
        const normalizedEmbedding = normalizeEmbeddingConfig(config);
        const normalizedConfig: Parameters<CoworkStore['setConfig']>[0] = {
          ...config,
          executionMode: normalizedExecutionMode,
          permissionMode: normalizedPermissionMode,
          permissionModeBySession: normalizedPermissionModeBySession,
          ...normalizedEmbedding,
        };
        const previousConfig = getCoworkStore().getConfig();
        const previousWorkingDir = previousConfig.workingDirectory;
        getCoworkStore().setConfig(normalizedConfig);
        if (normalizedPermissionModeBySession !== undefined) {
          for (const [sessionId, mode] of getChangedSessionPermissionModes(
            previousConfig.permissionModeBySession ?? {},
            normalizedPermissionModeBySession,
            normalizedPermissionMode ?? previousConfig.permissionMode,
          )) {
            getPiRuntimeAdapter().setApprovalModeForSession(
              sessionId,
              mode === CoworkPermissionMode.AllowAll
                ? WorkbenchApprovalMode.AllowAll
                : WorkbenchApprovalMode.Ask,
            );
          }
        }
        if (
          normalizedConfig.workingDirectory !== undefined &&
          normalizedConfig.workingDirectory !== previousWorkingDir
        ) {
          getSkillManager().handleWorkingDirectoryChange();
          // Main agent workspace is decoupled from workingDirectory — no MEMORY.md
          // or IDENTITY.md sync needed here. The workspace is always at
          // {STATE_DIR}/workspace-main/ regardless of the user's working directory.
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set config',
        };
      }
    },
  );

  // ==================== Scheduled Task IPC Handlers (canonical SQLite + Pi) ====================

  registerActivityIpcHandlers(() => {
    activityService ??= new ActivityService(getStore().getDatabase());
    return activityService;
  });

  initCronJobServiceManager({
    getScheduledTaskService: getCanonicalScheduledTaskService,
  });
  initScheduledTaskHelpers({
    getIMGatewayManager: () => ({
      getConfig: () => getIMGatewayManager().getConfig() as unknown as Record<string, unknown>,
    }),
  });
  registerScheduledTaskHandlers({
    getCronJobService,
    getIMGatewayManager: () => ({
      getIMStore: () => ({
        getSessionMapping: (conversationId: string, platform: string) =>
          getIMGatewayManager()
            .getIMStore()
            .getSessionMapping(conversationId, platform as Platform),
        listSessionMappings: (platform: string, accountId?: string) =>
          getIMGatewayManager()
            .getIMStore()
            .listSessionMappings(platform as Platform, accountId),
      }),
    }),
  });

  // ==================== Permissions IPC Handlers ====================

  ipcMain.handle('permissions:checkCalendar', async () => {
    try {
      const status = await checkCalendarPermission();

      // Development mode: Auto-request permission if not determined
      // This provides a better dev experience without affecting production
      if (isDev && status === 'not-determined' && process.platform === 'darwin') {
        console.log('[Permissions] Development mode: Auto-requesting calendar permission...');
        try {
          await requestCalendarPermission();
          const newStatus = await checkCalendarPermission();
          console.log(
            '[Permissions] Development mode: Permission status after request:',
            newStatus,
          );
          return { success: true, status: newStatus, autoRequested: true };
        } catch (requestError) {
          console.warn('[Permissions] Development mode: Auto-request failed:', requestError);
        }
      }

      return { success: true, status };
    } catch (error) {
      console.error('[Main] Error checking calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check permission',
      };
    }
  });

  ipcMain.handle('permissions:requestCalendar', async () => {
    try {
      // Request permission and check status
      const granted = await requestCalendarPermission();
      const status = await checkCalendarPermission();
      return { success: true, granted, status };
    } catch (error) {
      console.error('[Main] Error requesting calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to request permission',
      };
    }
  });

  // ==================== IM Gateway IPC Handlers ====================

  ipcMain.handle('im:config:get', async () => {
    try {
      const config = getIMGatewayManager().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM config',
      };
    }
  });

  // Debounce and serialize sidecar reconciliation after IM config changes.
  // Rapid sequential config changes (e.g. toggling 4 platforms) are coalesced
  // into a single gateway restart instead of N restarts.
  // The running/pending flags prevent concurrent sync operations from racing:
  // if a sync is in progress when new changes arrive, they are queued and
  // a follow-up sync runs after the current one completes.
  let imConfigSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let imConfigSyncRunning = false;
  let imConfigSyncPending = false;
  const IM_CONFIG_SYNC_DEBOUNCE_MS = 600;

  const doImConfigSync = async () => {
    imConfigSyncRunning = true;
    try {
      await reconcileCcConnectChannelSidecars();
    } catch (error) {
      console.error('[IM] Sidecar reconciliation failed:', error);
    } finally {
      imConfigSyncRunning = false;
      if (imConfigSyncPending) {
        imConfigSyncPending = false;
        scheduleImConfigSync();
      }
    }
  };

  const scheduleImConfigSync = () => {
    if (imConfigSyncRunning) {
      // A sync is already in progress; mark pending so it re-runs after completion.
      imConfigSyncPending = true;
      return;
    }
    if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
    imConfigSyncTimer = setTimeout(() => {
      imConfigSyncTimer = null;
      void doImConfigSync();
    }, IM_CONFIG_SYNC_DEBOUNCE_MS);
  };

  const reconcileImConfigImmediately = async (): Promise<void> => {
    if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
    imConfigSyncTimer = null;
    imConfigSyncPending = false;
    await reconcileCcConnectChannelSidecars();
  };

  ipcMain.handle(
    ImIpc.ConfigSet,
    async (_event, config: IMGatewayConfigPatch, options?: { syncGateway?: boolean }) => {
      try {
        const sanitizedConfig = sanitizeRendererIMConfigPatch(config);
        getIMGatewayManager().setConfig(sanitizedConfig, {
          syncGateway: options?.syncGateway,
        });

        const hasChannelChange =
          sanitizedConfig.telegram ||
          sanitizedConfig.discord ||
          sanitizedConfig.dingtalk ||
          sanitizedConfig.feishu ||
          sanitizedConfig.qq ||
          sanitizedConfig.wecom ||
          sanitizedConfig.weixin;
        if (options?.syncGateway && hasChannelChange) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set IM config',
        };
      }
    },
  );

  // Apply persisted channel configuration to cc-connect sidecars.
  ipcMain.handle('im:config:sync', async () => {
    try {
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync IM config',
      };
    }
  });

  ipcMain.handle('im:gateway:start', async (_event, platform: Platform) => {
    try {
      // Persist enabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: true } });
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start gateway',
      };
    }
  });

  ipcMain.handle('im:gateway:stop', async (_event, platform: Platform) => {
    try {
      // Persist disabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: false } });
      await reconcileCcConnectChannelSidecars();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop gateway',
      };
    }
  });

  ipcMain.handle(WeixinInstallIpc.Start, async () => {
    try {
      const executable = resolveCcConnectSidecarExecutable();
      if (!executable) throw new Error('Channel runtime is not bundled');
      const result = await runCcConnectWeixinSetup(executable, 'start');
      return {
        success: true,
        status: result.status,
        qrcode: result.qrcode,
        qrcodeUrl: result.qrcodeUrl,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start Weixin setup',
      };
    }
  });

  ipcMain.handle(WeixinInstallIpc.Poll, async (_event, qrcode: string) => {
    try {
      if (!qrcode?.trim()) throw new Error('Weixin QR code is required');
      const executable = resolveCcConnectSidecarExecutable();
      if (!executable) throw new Error('Channel runtime is not bundled');
      const result = await runCcConnectWeixinSetup(executable, 'poll', qrcode);
      if (result.status === 'confirmed') {
        if (!result.accountId || !result.botToken || !result.baseUrl) {
          throw new Error('Weixin login result is incomplete');
        }
        getIMGatewayManager().setConfig({
          weixin: {
            ...getIMGatewayManager().getConfig().weixin,
            enabled: true,
            accountId: result.accountId,
            token: result.botToken,
            baseUrl: result.baseUrl,
          },
        });
        await reconcileImConfigImmediately();
      }
      return {
        success: true,
        status: result.status,
        accountId: result.status === 'confirmed' ? result.accountId : undefined,
      };
    } catch (error) {
      return {
        success: false,
        status: 'wait',
        message: error instanceof Error ? error.message : 'Failed to poll Weixin setup',
      };
    }
  });

  ipcMain.handle(
    ImIpc.GatewayTest,
    async (
      _event,
      platform: Platform,
      configOverride?: Partial<IMGatewayConfig>,
      accountId?: string,
    ) => {
      try {
        const result = await getIMGatewayManager().testGateway(platform, configOverride, accountId);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
        };
      }
    },
  );

  ipcMain.handle(ImIpc.StatusGet, async () => {
    try {
      await refreshCcConnectPlatformStatuses();
      const status = getIMGatewayManager().getStatus(instanceId => {
        return resolveCcConnectAccountRuntimeStatus(
          ccConnectRuntimeStatuses,
          instanceId,
          ccConnectSidecarManager?.running === true,
        );
      });
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM status',
      };
    }
  });

  ipcMain.handle('im:getLocalIp', () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  });
  // DingTalk Multi-Instance handlers
  ipcMain.handle('im:dingtalk:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DINGTALK_CHANNEL_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'DingTalk Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteDingTalkInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete DingTalk instance',
      };
    }
  });

  ipcMain.handle(
    'im:dingtalk:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<DingTalkInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set DingTalk instance config',
        };
      }
    },
  );

  // QQ Multi-Instance handlers
  ipcMain.handle('im:qq:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_QQ_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'QQ Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteQQInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete QQ instance',
      };
    }
  });

  ipcMain.handle(
    'im:qq:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<QQInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set QQ instance config',
        };
      }
    },
  );

  // Feishu Multi-Instance handlers
  ipcMain.handle('im:feishu:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_FEISHU_CHANNEL_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Feishu Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteFeishuInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Feishu instance',
      };
    }
  });

  ipcMain.handle(
    'im:feishu:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<FeishuInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Feishu instance config',
        };
      }
    },
  );

  // WeCom Multi-Instance handlers
  ipcMain.handle('im:wecom:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_WECOM_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'WeCom Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add WeCom instance',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteWecomInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete WeCom instance',
      };
    }
  });

  ipcMain.handle(
    'im:wecom:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<WecomInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set WeCom instance config',
        };
      }
    },
  );

  // Telegram Multi-Instance handlers
  ipcMain.handle('im:telegram:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_TELEGRAM_CHANNEL_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Telegram Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteTelegramInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Telegram instance',
      };
    }
  });

  ipcMain.handle(
    'im:telegram:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<TelegramInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Telegram instance config',
        };
      }
    },
  );

  // Discord Multi-Instance handlers
  ipcMain.handle('im:discord:instance:add', async (_event, name: string, workspaceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DISCORD_CHANNEL_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Discord Bot',
        workspaceId,
      };
      getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
      scheduleImConfigSync();
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:delete', async (_event, instanceId: string) => {
    try {
      getIMGatewayManager().getIMStore().deleteDiscordInstance(instanceId);
      scheduleImConfigSync();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Discord instance',
      };
    }
  });

  ipcMain.handle(
    'im:discord:instance:config:set',
    async (
      _event,
      instanceId: string,
      config: Partial<DiscordInstanceConfig>,
      options?: { syncGateway?: boolean },
    ) => {
      try {
        getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, config);
        if (options?.syncGateway) {
          scheduleImConfigSync();
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set Discord instance config',
        };
      }
    },
  );

  ipcMain.handle(
    'feishu:install:verify',
    async (_event, { appId, appSecret }: { appId: string; appSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyFeishuCredentials(appId, appSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

  // DingTalk bot install helpers
  ipcMain.handle('dingtalk:install:qrcode', async () => {
    try {
      return await getIMGatewayManager().startDingTalkInstallQrcode();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle(
    'dingtalk:install:poll',
    async (_event, { deviceCode }: { deviceCode: string }) => {
      try {
        return await getIMGatewayManager().pollDingTalkInstall(deviceCode);
      } catch (error) {
        return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
      }
    },
  );

  ipcMain.handle(
    'dingtalk:install:verify',
    async (_event, { clientId, clientSecret }: { clientId: string; clientSecret: string }) => {
      try {
        return await getIMGatewayManager().verifyDingTalkCredentials(clientId, clientSecret);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '验证失败' };
      }
    },
  );

  // GitHub Copilot device code authentication handlers
  ipcMain.handle('github-copilot:request-device-code', async () => {
    const { requestDeviceCode } = await import('./libs/githubCopilotAuth.js');
    try {
      const result = await requestDeviceCode();
      return {
        userCode: result.user_code,
        verificationUri: result.verification_uri,
        deviceCode: result.device_code,
        interval: result.interval,
        expiresIn: result.expires_in,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to request device code');
    }
  });

  ipcMain.handle(
    'github-copilot:poll-for-token',
    async (
      _event,
      {
        deviceCode,
        interval,
        expiresIn,
      }: { deviceCode: string; interval: number; expiresIn: number },
    ) => {
      const { pollForAccessToken, getCopilotToken, getGitHubUser } =
        await import('./libs/githubCopilotAuth.js');
      try {
        const githubAccessToken = await pollForAccessToken(deviceCode, interval, expiresIn);
        const githubUser = await getGitHubUser(githubAccessToken);
        const {
          token: copilotToken,
          expiresAt,
          baseUrl,
        } = await getCopilotToken(githubAccessToken);
        // Store the GitHub access token for later token refresh
        getStore().set('github_copilot_github_token', githubAccessToken);
        // Register with the token manager for automatic refresh
        setCopilotTokenState({ copilotToken, baseUrl, expiresAt, githubToken: githubAccessToken });
        return { success: true, token: copilotToken, githubUser, baseUrl };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        };
      }
    },
  );

  ipcMain.handle('github-copilot:cancel-polling', async () => {
    const { cancelPolling } = await import('./libs/githubCopilotAuth.js');
    cancelPolling();
  });

  ipcMain.handle('github-copilot:sign-out', async () => {
    getStore().delete('github_copilot_github_token');
    clearCopilotTokenState();
  });

  ipcMain.handle('github-copilot:refresh-token', async () => {
    try {
      const state = await refreshCopilotTokenNow();
      return { success: true, token: state.copilotToken, baseUrl: state.baseUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
      };
    }
  });

  // OpenAI ChatGPT (Codex) OAuth handlers — see src/main/libs/openaiCodexAuth.ts.
  // The login flow opens a browser to https://auth.openai.com/oauth/authorize
  // and listens on http://127.0.0.1:1455/auth/callback for the redirect, then
  // writes <CODEX_HOME>/auth.json for the Pi provider route.
  ipcMain.handle('openai-codex-oauth:start', async () => {
    const { startOpenAICodexLogin } = await import('./libs/openaiCodexAuth.js');
    try {
      const tokens = await startOpenAICodexLogin();
      return {
        success: true as const,
        email: tokens.email ?? null,
        accountId: tokens.accountId ?? null,
        expiresAt: tokens.expiresAt,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'ChatGPT login failed',
      };
    }
  });

  ipcMain.handle('openai-codex-oauth:cancel', async () => {
    const { cancelOpenAICodexLogin } = await import('./libs/openaiCodexAuth.js');
    cancelOpenAICodexLogin();
  });

  ipcMain.handle('openai-codex-oauth:logout', async () => {
    const { logoutOpenAICodex } = await import('./libs/openaiCodexAuth.js');
    logoutOpenAICodex();
  });

  ipcMain.handle('openai-codex-oauth:status', async () => {
    const { readOpenAICodexAuthFile } = await import('./libs/openaiCodexAuth.js');
    const tokens = readOpenAICodexAuthFile();
    if (!tokens) return { loggedIn: false as const };
    return {
      loggedIn: true as const,
      email: tokens.email ?? null,
      accountId: tokens.accountId ?? null,
      expiresAt: tokens.expiresAt,
    };
  });

  ipcMain.handle('generate-session-title', async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
  });

  ipcMain.handle('get-recent-cwds', async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore()
      .listRecentCwds(20)
      .filter(cwd => !isInternalWorkspacePath(cwd))
      .slice(0, boundedLimit);
  });

  ipcMain.handle('get-api-config', async () => {
    return getCurrentApiConfig();
  });

  ipcMain.handle('check-api-config', async (_event, options?: { probeModel?: boolean }) => {
    const { config, error } = resolveCurrentApiConfig();
    if (config && options?.probeModel) {
      const probe = await probeCoworkModelReadiness();
      if (probe.ok === false) {
        return { hasConfig: false, config: null, error: probe.error };
      }
    }
    return { hasConfig: config !== null, config, error };
  });

  ipcMain.handle(
    'save-api-config',
    async (
      _event,
      config: {
        apiKey: string;
        baseURL: string;
        model: string;
        apiType?: 'anthropic' | 'openai';
      },
    ) => {
      try {
        saveCoworkApiConfig(config);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save API config',
        };
      }
    },
  );

  // Dialog handlers
  ipcMain.handle('dialog:selectDirectory', async (event, options?: { defaultPath?: string }) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = options?.defaultPath?.trim();
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      ...(defaultPath ? { defaultPath } : {}),
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle(
    'dialog:selectFile',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, path: null };
      }
      return { success: true, path: result.filePaths[0] };
    },
  );

  ipcMain.handle(
    'dialog:selectFiles',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, paths: [] };
      }
      return { success: true, paths: result.filePaths };
    },
  );

  ipcMain.handle(
    'dialog:showMessageBox',
    async (
      event,
      options: {
        message: string;
        type?: 'none' | 'info' | 'error' | 'question' | 'warning';
        title?: string;
      },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const { dialog } = await import('electron');
      return dialog.showMessageBox(ownerWindow!, {
        type: options.type || 'warning',
        title: options.title || '',
        message: options.message,
        buttons: ['OK'],
      });
    },
  );

  ipcMain.handle(
    'dialog:saveInlineFile',
    async (
      _event,
      options?: { dataBase64?: string; fileName?: string; mimeType?: string; cwd?: string },
    ) => {
      try {
        const dataBase64 = typeof options?.dataBase64 === 'string' ? options.dataBase64.trim() : '';
        if (!dataBase64) {
          return { success: false, path: null, error: 'Missing file data' };
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length) {
          return { success: false, path: null, error: 'Invalid file data' };
        }
        if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
          return {
            success: false,
            path: null,
            error: `File too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
          };
        }

        const dir = resolveInlineAttachmentDir(options?.cwd);
        await fs.promises.mkdir(dir, { recursive: true });

        const safeFileName = sanitizeAttachmentFileName(options?.fileName);
        const extension = inferAttachmentExtension(safeFileName, options?.mimeType);
        const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
        const outputPath = path.join(dir, finalName);

        await fs.promises.writeFile(outputPath, buffer);
        return { success: true, path: outputPath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to save inline file',
        };
      }
    },
  );

  // Read a local file as a data URL (data:<mime>;base64,...)
  const MAX_READ_AS_DATA_URL_BYTES = 20 * 1024 * 1024;
  const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
  };
  ipcMain.handle(
    'dialog:readFileAsDataUrl',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (stat.size > MAX_READ_AS_DATA_URL_BYTES) {
          return {
            success: false,
            error: `File too large (max ${Math.floor(MAX_READ_AS_DATA_URL_BYTES / (1024 * 1024))}MB)`,
          };
        }
        const buffer = await fs.promises.readFile(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file',
        };
      }
    },
  );

  ipcMain.handle(
    'dialog:generateThumbnail',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (process.platform !== 'darwin') {
          return { success: false, error: 'Thumbnail generation only supported on macOS' };
        }
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const tmpDir = path.join(app.getPath('temp'), 'zhiyuan-thumbnails');
        await fs.promises.mkdir(tmpDir, { recursive: true });
        const baseName = path.basename(resolvedPath);
        const outputFile = path.join(tmpDir, `${baseName}.png`);
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        await execFileAsync('qlmanage', ['-t', '-s', '1200', '-o', tmpDir, resolvedPath]);
        const thumbBuffer = await fs.promises.readFile(outputFile);
        const base64 = thumbBuffer.toString('base64');
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        return { success: true, dataUrl: `data:image/png;base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate thumbnail',
        };
      }
    },
  );

  // Shell handlers - 打开文件/文件夹
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const result = await shell.openPath(normalizedPath);
      if (result) {
        // 如果返回非空字符串，表示打开失败
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openHtmlInBrowser', async (_event, htmlContent: string) => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'zhiyuan-preview');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
      if (process.platform === 'win32') {
        const result = await shell.openPath(tmpFile);
        if (result) return { success: false, error: result };
      } else {
        await shell.openExternal(pathToFileURL(tmpFile).href);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(AppUpdateIpc.GetState, async () => {
    return getAppUpdateCoordinator().getState();
  });

  ipcMain.handle(AppUpdateIpc.CheckNow, async (_event, options?: { manual?: boolean }) => {
    return getAppUpdateCoordinator().checkNow(options);
  });

  ipcMain.handle(AppUpdateIpc.RetryDownload, async () => {
    const state = await getAppUpdateCoordinator().retryDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.PauseDownload, async () => {
    const state = getAppUpdateCoordinator().pauseDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.ResumeDownload, async () => {
    const state = getAppUpdateCoordinator().resumeDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.CancelDownload, async () => {
    const state = getAppUpdateCoordinator().cancelDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.InstallReady, async () => {
    return getAppUpdateCoordinator().installReadyUpdate();
  });

  // Helper: detect if a URL belongs to GitHub Copilot and apply token refresh on 401.
  const isCopilotUrl = (url: string) => url.includes('githubcopilot.com');
  const retryCopilotWithRefreshedToken = async (opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ headers: Record<string, string>; retried: boolean }> => {
    try {
      const state = await refreshCopilotTokenNow();
      const refreshedHeaders = { ...opts.headers, Authorization: `Bearer ${state.copilotToken}` };
      console.log('[CopilotRetry] token refreshed, retrying request');
      return { headers: refreshedHeaders, retried: true };
    } catch (err) {
      console.warn('[CopilotRetry] token refresh failed, not retrying:', err);
      return { headers: opts.headers, retried: false };
    }
  };

  // API 代理处理程序 - 解决 CORS 问题
  ipcMain.handle(ApiIpc.WebSearch, async (_event, rawInput: unknown) => {
    const input =
      rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
    const requestId = typeof input.requestId === 'string' ? input.requestId : null;
    const controller = new AbortController();
    if (requestId) activeStreamControllers.set(requestId, controller);
    try {
      const data = await searchAnySearchGateway(input, controller.signal);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Search unavailable.' };
    } finally {
      if (requestId && activeStreamControllers.get(requestId) === controller) {
        activeStreamControllers.delete(requestId);
      }
    }
  });

  ipcMain.handle('api:fetch', async (_event, rawOptions: unknown) => {
    const options = ApiFetchSchema.input.parse(rawOptions);
    console.log(
      `[api:fetch] ${options.method} ${options.url}, headers: ${serializeForLog(options.headers)}, body: ${options.body}`,
    );

    const doFetch = async (headers: Record<string, string>) => {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers,
        body: options.body,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: string | object;

      if (contentType.includes('text/event-stream')) {
        data = await response.text();
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    };

    try {
      let result = await doFetch(options.headers);
      console.log(
        `[api:fetch] ${options.method} ${options.url} -> ${result.status} ${result.statusText}`,
        typeof result.data === 'object' ? JSON.stringify(result.data) : result.data,
      );

      // Auto-retry once for Copilot 401/403
      if (
        !result.ok &&
        (result.status === 401 || result.status === 403) &&
        isCopilotUrl(options.url)
      ) {
        console.log('[api:fetch] Copilot auth error, attempting token refresh and retry');
        const { headers: refreshedHeaders, retried } =
          await retryCopilotWithRefreshedToken(options);
        if (retried) {
          result = await doFetch(refreshedHeaders);
          console.log(`[api:fetch] retry -> ${result.status} ${result.statusText}`);
        }
      }

      return result;
    } catch (error) {
      console.error(
        `[api:fetch] ${options.method} ${options.url} -> ERROR:`,
        error instanceof Error ? error.message : error,
      );
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error',
        headers: {},
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // SSE 流式 API 代理
  ipcMain.handle('api:stream', async (event, rawOptions: unknown) => {
    const options = ApiStreamSchema.input.parse(rawOptions);
    const controller = new AbortController();

    // 存储 controller 以便后续取消
    activeStreamControllers.set(options.requestId, controller);

    try {
      let response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });

      // Auto-retry once for Copilot 401/403
      if (
        !response.ok &&
        (response.status === 401 || response.status === 403) &&
        isCopilotUrl(options.url)
      ) {
        console.log('[api:stream] Copilot auth error, attempting token refresh and retry');
        const { headers: refreshedHeaders, retried } =
          await retryCopilotWithRefreshedToken(options);
        if (retried) {
          response = await session.defaultSession.fetch(options.url, {
            method: options.method,
            headers: refreshedHeaders,
            body: options.body,
            signal: controller.signal,
          });
          console.log(`[api:stream] retry -> ${response.status} ${response.statusText}`);
        }
      }

      if (!response.ok) {
        const errorData = await response.text();
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        };
      }

      if (!response.body) {
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: 'No response body',
        };
      }

      // 读取流式响应并通过 IPC 发送
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const readStream = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              event.sender.send(`api:stream:${options.requestId}:done`);
              break;
            }
            const chunk = decoder.decode(value);
            event.sender.send(`api:stream:${options.requestId}:data`, chunk);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            event.sender.send(`api:stream:${options.requestId}:abort`);
          } else {
            event.sender.send(
              `api:stream:${options.requestId}:error`,
              error instanceof Error ? error.message : 'Stream error',
            );
          }
        } finally {
          activeStreamControllers.delete(options.requestId);
        }
      };

      // 异步读取流，立即返回成功状态
      readStream();

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      activeStreamControllers.delete(options.requestId);
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // 取消流式请求
  ipcMain.handle('api:stream:cancel', (_event, requestId: string) => {
    const controller = activeStreamControllers.get(requestId);
    if (controller) {
      controller.abort();
      activeStreamControllers.delete(requestId);
      return true;
    }
    return false;
  });

  // ─── end OAuth ───

  // 企微 SDK 授权弹窗白名单域名
  const WECOM_AUTH_HOSTNAMES = new Set([
    'work.weixin.qq.com',
    'open.work.weixin.qq.com',
    'wwcdn.weixin.qq.com',
  ]);

  const isWecomAuthUrl = (url: string): boolean => {
    try {
      const hostname = new URL(url).hostname;
      return WECOM_AUTH_HOSTNAMES.has(hostname);
    } catch {
      return false;
    }
  };

  const isArtifactSandboxUrl = (url: string): boolean => {
    try {
      const pathname = new URL(url).pathname;
      return (
        pathname.endsWith('/artifact-react-sandbox.html') ||
        pathname.includes('/vendor/react.production.min.js') ||
        pathname.includes('/vendor/react-dom.production.min.js') ||
        pathname.includes('/vendor/babel.min.js')
      );
    } catch {
      return false;
    }
  };

  // 设置 Content Security Policy
  const setContentSecurityPolicy = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // 跳过企微授权页面，让其使用自身的 CSP（否则外部脚本被阻止导致空白页）
      if (isWecomAuthUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      // 跳过 artifact 沙箱及其 vendor 脚本的 CSP（iframe sandbox="allow-scripts" 隔离）
      if (isArtifactSandboxUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': createContentSecurityPolicy({
            isDev,
            electronStartUrl: process.env.ELECTRON_START_URL,
          }),
        },
      });
    });
  };

  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
      return;
    }

    const initialWindowState = resolveInitialAppWindowState(
      getStore().get(AppWindowStoreKey.State),
      getDisplayWorkAreas(),
    );
    const { isMaximized: shouldRestoreMaximized, ...initialWindowBounds } = initialWindowState;

    mainWindow = new BrowserWindow({
      ...initialWindowBounds,
      title: APP_NAME,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 20 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: getTitleBarOverlayOptions(),
            }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: PRELOAD_PATH,
        backgroundThrottling: false,
        devTools: isDev,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: isLinuxRendererSmoke,
      autoHideMenuBar: true,
      enableLargerThanScreen: false,
    });

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      // Use a PNG with extra transparent padding. NativeImage reliably loads
      // this in development and it keeps the Dock visual size below the
      // packaged app's full-bleed icon.
      const iconPath = path.join(__dirname, '../build/icons/png/mac-dev-dock.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    mainWindow.setMenu(null);

    // 处理 window.open 请求（企微 SDK 授权弹窗等）
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isWecomAuthUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 950,
            height: 640,
            title: '企业微信授权',
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 监听子窗口创建事件（企微授权弹窗安全限制）
    mainWindow.webContents.on('did-create-window', childWindow => {
      // 限制子窗口只能导航到企微域名，防止被劫持到其他站点
      childWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!isWecomAuthUrl(navUrl)) {
          event.preventDefault();
        }
      });
    });

    // 设置窗口的最小尺寸
    mainWindow.setMinimumSize(MIN_APP_WINDOW_WIDTH, MIN_APP_WINDOW_HEIGHT);
    if (shouldRestoreMaximized) {
      mainWindow.maximize();
    }

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      emitWindowState();
    });

    // 处理窗口关闭
    mainWindow.on('close', e => {
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      persistAppWindowState();

      // In development, close should actually quit so `npm run electron:dev`
      // restarts from a clean process. In production we keep tray behavior.
      if (mainWindow && !isQuitting && !isDev) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        mainWindow?.loadURL(DEV_SERVER_URL).catch(err => {
          console.error('Failed to load URL:', err);
          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Retrying to load URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('Failed to load URL after maximum retries');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();

      // 打开开发者工具
      mainWindow.webContents.openDevTools();
    } else {
      // 生产环境
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error('Page failed to load:', errorCode, errorDescription);
        // 如果加载失败，尝试重新加载
        if (isDev) {
          setTimeout(() => {
            scheduleReload('did-fail-load');
          }, 3000);
        }
      },
    );

    // 当窗口关闭时，清除引用
    mainWindow.on('closed', () => {
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      mainWindow = null;
    });

    const forwardWindowState = () => emitWindowState();
    const forwardAndPersistWindowState = () => {
      emitWindowState();
      schedulePersistAppWindowState();
    };
    mainWindow.on('resize', schedulePersistAppWindowState);
    mainWindow.on('move', schedulePersistAppWindowState);
    mainWindow.on('maximize', forwardAndPersistWindowState);
    mainWindow.on('unmaximize', forwardAndPersistWindowState);
    mainWindow.on('enter-full-screen', forwardAndPersistWindowState);
    mainWindow.on('leave-full-screen', forwardAndPersistWindowState);
    mainWindow.on('focus', forwardWindowState);
    mainWindow.on('blur', forwardWindowState);
    mainWindow.on('session-end', () => {
      recordAppQuitOrigin(AppQuitOrigin.OperatingSystemSessionEnd);
      logAppQuitContextOnce();
    });

    // Some Linux desktop/GPU combinations finish loading without emitting ready-to-show.
    // Show the loaded window so the first launch does not remain hidden until a second click.
    mainWindow.webContents.once('did-finish-load', () => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isVisible() &&
        (isLinuxRendererSmoke || !isAutoLaunched())
      ) {
        console.warn(
          '[MainWindow] Page loaded before ready-to-show; showing the initial window now.',
        );
        mainWindow.show();
      }
    });

    // 等待内容加载完成后再显示窗口
    mainWindow.once('ready-to-show', () => {
      emitWindowState();
      // 开机自启时不显示窗口，仅显示托盘图标
      if (isLinuxRendererSmoke || !isAutoLaunched()) {
        mainWindow?.show();
      }
      // Initialize main-process i18n from stored language before creating UI elements.
      const initLang = getStore().get<{ language?: string }>('app_config')?.language;
      setLanguage(initLang === 'en' ? 'en' : 'zh');
      // 窗口就绪后创建系统托盘
      createTray(() => mainWindow);

      // Start cron polling after the window is ready.
      (async () => {
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] Canonical scheduler not available yet:', err);
        }

        // One-time migration: import legacy SQLite task records into the
        // canonical scheduler. No task is delegated to another runtime.
        migrateLegacyScheduledTasksToCanonical({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          store: new SqliteScheduledTaskStore(getStore().getDatabase()),
        }).catch(err => {
          console.warn('[Main] Canonical scheduled-task migration failed:', err);
        });
        migrateLegacyScheduledTaskRunsToCanonical({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          store: new SqliteScheduledTaskStore(getStore().getDatabase()),
        }).catch(err => {
          console.warn('[Main] Canonical scheduled-task Run migration failed:', err);
        });
      })();
    });
  };

  let isCleanupFinished = false;
  let isCleanupInProgress = false;
  let hasLoggedAppQuitContext = false;

  const logAppQuitContextOnce = (): void => {
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

  const runAppCleanup = async (): Promise<void> => {
    console.log('[AppLifecycle] App cleanup started.');
    destroyTray();
    skillManager?.stopWatching();

    await disposeZhiyuanEnterpriseExtension().catch(error => {
      console.error('[EnterpriseExtension] Failed to dispose enterprise extension:', error);
    });

    // Stop all active Pi sessions without blocking shutdown.
    console.log('[Main] Stopping cowork sessions...');
    if (piRuntimeAdapter) piRuntimeAdapter.stopAllSessions();

    await piModelCatalogRefreshCoordinator?.stop();
    piModelCatalogRefreshCoordinator = null;

    await stopCoworkOpenAICompatProxy().catch(error => {
      console.error('Failed to stop OpenAI compatibility proxy:', error);
    });

    // Stop skill services.
    const skillServices = getSkillServiceManager();
    await skillServices.stopAll();

    await ccConnectBridgeServer?.stop().catch(error => {
      console.error('[cc-connect] Failed to stop bridge on quit:', error);
    });
    ccConnectBridgeServer = null;
    ccConnectRuntimeStopping = true;
    if (ccConnectRuntimeRestartTimer) clearTimeout(ccConnectRuntimeRestartTimer);
    ccConnectRuntimeRestartTimer = null;
    await ccConnectSidecarManager?.stop();
    ccConnectSidecarManager = null;
    ccConnectRuntimeControlClient = null;

    if (ollamaManager) {
      await ollamaManager.shutdownForQuit().catch(error => {
        console.error('[Ollama] Failed to stop service on quit:', error);
      });
    }

    if (llamaCppManager) {
      await llamaCppManager.shutdownForQuit().catch(error => {
        console.error('[LlamaCpp] Failed to stop service on quit:', error);
      });
    }

    if (engramManager) {
      await engramManager.stop().catch(error => {
        console.error('[MemoryRuntime] Failed to stop local memory service:', error);
      });
    }

    if (codingRoomService) {
      await codingRoomService.dispose().catch(error => {
        console.error('[CodingRoom] Failed to dispose coding agent connections on quit:', error);
      });
    }

    // Stop the cron job polling
    try {
      getCronJobService().stopPolling();
    } catch {
      // The canonical scheduler may not have been initialized — safe to ignore.
    }

    sqliteBackupManager?.stopPeriodicBackupLoop();
    todoReminderScheduler?.stop();
    todoReminderScheduler = null;

    // Close the SQLite database to flush the WAL and release the file lock.
    try {
      getStore().close();
    } catch {
      // Store may not have been initialized — safe to ignore.
    }
  };

  app.on('before-quit', e => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    logAppQuitContextOnce();
    isCleanupInProgress = true;
    isQuitting = true;

    void runAppCleanup()
      .catch(error => {
        console.error('[Main] Cleanup error:', error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  });

  const handleTerminationSignal = (signal: NodeJS.Signals, origin: AppQuitOrigin) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    recordAppQuitOrigin(origin);
    logAppQuitContextOnce();
    console.log(`[AppLifecycle] Received ${signal}; running cleanup before exit.`);
    isCleanupInProgress = true;
    isQuitting = true;
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

  process.once('SIGINT', () => handleTerminationSignal('SIGINT', AppQuitOrigin.SignalInterrupt));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM', AppQuitOrigin.SignalTerminate));

  // 初始化应用
  const initApp = async () => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');

    protocol.handle(ZHIYUAN_ENTERPRISE_RENDERER_SCHEME, async request => {
      const assetPath = zhiyuanEnterpriseRendererBridge.resolveAsset(request.url);
      if (!assetPath) return new Response(null, { status: 404 });
      const response = await net.fetch(pathToFileURL(assetPath).toString());
      return allowEnterpriseRendererOpaqueOrigin(response);
    });

    const enterpriseExtension = await initializeZhiyuanEnterpriseExtension({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      developmentExtensionPath: process.env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH,
      sessionCapability: zhiyuanEnterpriseSessionBridge,
      managedProviderCapability: zhiyuanManagedProviderBridge,
      createSkillCapability: () =>
        new ZhiyuanEnterpriseSkillBridge({
          userDataPath: app.getPath('userData'),
          refreshSkills: () => getSkillManager().handleWorkingDirectoryChange(),
        }),
      createRendererCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedCapability(extensionDirectory),
      createSettingsCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedSettingsCapability(extensionDirectory),
    });
    if (enterpriseExtension.extensionId) {
      console.log(
        `[EnterpriseExtension] Initialized ${enterpriseExtension.extensionId} with API version 1.`,
      );
    }

    void getEngramManager()
      .start()
      .then(connection => {
        if (!connection || !store) return;
        void getProjectMemoryService()
          .drainOutbox()
          .catch(error =>
            console.warn('[ProjectMemory] Failed to drain pending operations:', error),
          );
      })
      .catch(error => console.warn('[MemoryRuntime] Failed to start local memory service:', error));

    // Note: Calendar permission is checked on-demand when calendar operations are requested
    // We don't trigger permission dialogs at startup to avoid annoying users

    // Ensure default working directory exists
    const defaultProjectDir = path.join(os.homedir(), 'zhiyuan', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('Created default project directory:', defaultProjectDir);
    }
    console.log('[Main] initApp: default project dir ensured');

    // 注册 localfile:// 自定义协议，用于安全加载本地文件（图片等）
    protocol.handle('localfile', request => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname);
      return net.fetch(`file://${filePath}`);
    });

    profiler.mark('initStore');
    console.log('[Main] initApp: starting initStore()');
    store = await initStore();
    zhiyuanManagedProviderBridge.attachStore(store);
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    try {
      const legacyMemoryImport = importLegacyMemoryFileCandidates({
        agentWorkspace: getMainAgentWorkspace(),
        service: getProjectMemoryService(),
      });
      const legacySqliteMemoryImport = importLegacySqliteMemoryCandidates({
        store: getCoworkStore(),
        service: getProjectMemoryService(),
      });
      const importedLegacyMemories =
        legacyMemoryImport.imported + legacySqliteMemoryImport.imported;
      if (importedLegacyMemories > 0) {
        console.log(
          `[MemoryMigration] imported ${importedLegacyMemories} legacy entries for review`,
        );
      }
    } catch (error) {
      console.warn('[MemoryMigration] Failed to import legacy memory sources:', error);
    }
    refreshEndpointsTestMode(store);
    sqliteBackupManager = new SqliteBackupManager(app.getPath('userData'));
    await startCcConnectBridge().catch(error =>
      console.error('[cc-connect] Failed to start local bridge:', error),
    );
    await reconcileCcConnectChannelSidecars().catch(error => {
      console.error('[ChannelRuntime] Failed to start unified runtime:', error);
    });
    const startSqliteBackupLoop = async (): Promise<void> => {
      if (!sqliteBackupManager) return;
      await sqliteBackupManager.startPeriodicBackupLoop(() => getStore().getDatabase());
    };

    const stopSqliteBackupLoop = (): void => {
      sqliteBackupManager?.stopPeriodicBackupLoop();
    };

    if (getSqliteAutoBackupEnabledFromConfig(getStore().get<AppConfigSettings>('app_config'))) {
      await startSqliteBackupLoop().catch(error => {
        console.error('[SqliteBackup] Failed to start periodic backup loop:', error);
      });
    }

    // Defensive recovery: app may be force-closed during execution and leave
    // stale running flags in DB. Normalize them on startup.
    const resetCount = getCoworkStore().resetRunningSessions();
    console.log('[Main] initApp: resetRunningSessions done, count:', resetCount);
    if (resetCount > 0) {
      console.log(`[Main] Reset ${resetCount} stuck cowork session(s) from running -> idle`);
    }
    activityService ??= new ActivityService(getStore().getDatabase());
    const recoveredActivityRuns = activityService.recoverInterruptedRuns();
    if (recoveredActivityRuns > 0) {
      console.warn(`[Activity] marked ${recoveredActivityRuns} interrupted activity run(s) as failed`);
    }
    const prunedActivityRuns = activityService.pruneExpired();
    if (prunedActivityRuns > 0) {
      console.log(`[Activity] removed ${prunedActivityRuns} expired activity run(s)`);
    }
    const recoveredScheduledRuns = new SqliteScheduledTaskStore(
      getStore().getDatabase(),
    ).recoverInterruptedRuns(run => {
      activityService?.upsertBestEffort({
        id: run.id,
        source: ActivitySource.ScheduledTask,
        status: ActivityStatus.Failed,
        startedAt: Date.parse(run.startedAt),
        updatedAt: Date.parse(run.finishedAt ?? run.startedAt),
        errorMessage: run.error ?? undefined,
      });
    });
    if (recoveredScheduledRuns > 0) {
      console.warn(`[Scheduler] marked ${recoveredScheduledRuns} interrupted Run(s) as failed`);
    }
    const recoveredWorkbenchTasks = getWorkbenchTaskService().recoverInterruptedState();
    if (recoveredWorkbenchTasks > 0) {
      console.log(
        `[WorkbenchTask] marked ${recoveredWorkbenchTasks} interrupted task(s) for explicit recovery`,
      );
    }
    void getProjectMemoryService()
      .drainOutbox()
      .catch(error => console.warn('[ProjectMemory] Failed to drain pending operations:', error));
    registerWorkbenchTaskIpcHandlers({
      getService: getWorkbenchTaskService,
      startPreparedRun: async (task: WorkbenchTask, run: WorkbenchRun, resumeInput) => {
        const session = getCoworkStore().getSession(task.sessionId);
        if (!session) throw new Error('Cowork session not found.');
        const config = getCoworkStore().getConfig();
        const amendment = resumeInput?.amendment?.trim() ?? '';
        const prompt =
          amendment || 'Continue the current task from its persisted state and verify the result.';
        const previousProduction =
          getWorkbenchTaskService().productionLoop.repository.getLatestForTask(task.id, run.id);
        await getPiRuntimeAdapter().continueSession(session.id, prompt, {
          systemPrompt: session.systemPrompt,
          skillIds: resumeInput?.skillIds ?? session.activeSkillIds,
          sessionMode: session.mode,
          workspaceRoot: session.cwd,
          agentId: session.agentId,
          expertIds:
            resumeInput?.expertIds === undefined
              ? session.experts.slice(0, 1).map(expert => expert.expertId)
              : normalizeSingleExpertIds(resumeInput.expertIds),
          modelOverride: session.modelOverride,
          approvalMode:
            config.permissionMode === CoworkPermissionMode.AllowAll
              ? WorkbenchApprovalMode.AllowAll
              : WorkbenchApprovalMode.Ask,
          goalMode: resumeInput?.goalMode,
          productionLoopMode: resumeInput?.productionLoopMode,
          imageAttachments: resumeInput?.imageAttachments,
          fileAttachments: resumeInput?.fileAttachments,
          _workbenchRunId: run.id,
          _productionWorkflowRequired: shouldRequireProductionOnResume(
            task.contract.kind,
            previousProduction,
          ),
          _skipUserMessage: !amendment,
        });
      },
    });
    todoReminderScheduler = new TodoReminderScheduler(getStore().getDatabase());
    todoReminderScheduler.start();
    registerTodoIpcHandlers(() => getStore().getDatabase(), {
      onMutation: () => todoReminderScheduler?.refresh(),
    });
    registerCodingAgentIpcHandlers(getCodingRoomService);
    const recoveredCodingLanes = getCodingRoomService().recoverInterruptedState();
    if (recoveredCodingLanes > 0) {
      console.warn(
        `[CodingAgent] recovered ${recoveredCodingLanes} interrupted lane(s) after restart`,
      );
    }
    void getCodingRoomService()
      .registry.discoverExternalAgents()
      .catch(error => {
        console.warn('[CodingAgent] External ACP discovery failed:', error);
      });
    registerMemoryIpcHandlers({
      getService: getProjectMemoryService,
      resolveSessionTitles: sessionIds =>
        resolveMemorySessionTitles(getStore().getDatabase(), sessionIds),
    });
    // Inject store getter into claudeSettings
    setStoreGetter(() => store);
    piModelCatalogRefreshCoordinator = new PiModelCatalogRefreshCoordinator({
      resolveApiKeys: resolveAllProviderApiKeys,
    });
    getStore().onDidChange<AppConfigSettings>('app_config', () => {
      piModelCatalogRefreshCoordinator?.notifyConfigurationChanged();
    });
    const localInferenceManager = getLlamaCppManager();
    localInferenceManager.initializeModelsDir();
    registerLlamaCppIpcHandlers(localInferenceManager, { getStore });
    // Warm the short-lived backend cache before the runtime settings dialog is opened.
    void localInferenceManager.listBackends();
    registerTriageIpcHandlers({ getStore });
    registerOllamaIpcHandlers(getOllamaManager(), {
      getStore,
    });
    registerMarketplaceIpcHandlers({
      getModelsDir: () => getLlamaCppManager().getModelsDir(),
      userDataPath: app.getPath('userData'),
    });
    registerProviderModelDiscoveryIpcHandler();
    // Initialize Copilot token manager and restore token state if available
    initCopilotTokenManager(getStore);
    const storedGithubToken = getStore().get('github_copilot_github_token') as string | undefined;
    if (storedGithubToken) {
      import('./libs/githubCopilotAuth.js')
        .then(({ getCopilotToken }) =>
          getCopilotToken(storedGithubToken).then(({ token, expiresAt, baseUrl }) => {
            setCopilotTokenState({
              copilotToken: token,
              baseUrl,
              expiresAt,
              githubToken: storedGithubToken,
            });
            console.log('[Main] restored Copilot token state from stored GitHub token');
          }),
        )
        .catch(err => {
          console.warn('[Main] failed to restore Copilot token on startup:', err);
        });
    }

    registerProxyTokenRefresher('github-copilot', async () => {
      try {
        const { refreshCopilotTokenNow } = await import('./libs/copilotTokenManager.js');
        const refreshed = await refreshCopilotTokenNow();
        return refreshed.copilotToken;
      } catch (err) {
        console.warn('[Auth] Copilot proxy token refresh failed:', err);
        return null;
      }
    });

    // Enterprise config sync must run before agent services initialize.
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        const mcpStoreInstance = getMcpStore();
        syncEnterpriseConfig(
          enterpriseConfigPath,
          store,
          server => {
            const existing = mcpStoreInstance.listServers().find(s => s.name === server.name);
            if (existing) {
              mcpStoreInstance.updateServer(existing.id, {
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            } else {
              mcpStoreInstance.createServer({
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            }
          },
          () => {
            // Clear all MCP servers (for overwrite mode)
            for (const s of mcpStoreInstance.listServers()) {
              mcpStoreInstance.deleteServer(s.id);
            }
          },
          () => {
            const cs = getCoworkStore();
            return cs.getConfig().workingDirectory;
          },
        );
      } catch (error) {
        console.error('[Enterprise] config sync failed:', error);
      }
    } else {
      // No enterprise config package found — clear any previously stored config
      // so the app exits enterprise mode after the package is removed.
      const hadEnterprise = store.get('enterprise_config');
      if (hadEnterprise) {
        store.delete('enterprise_config');
        // Reset executionMode to default so sandbox mode reverts to "off".
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: 'local' });
        console.log(
          '[Enterprise] config package removed, cleared enterprise mode and reset executionMode',
        );
      }
    }
    profiler.measure('enterpriseConfigSync');

    // Start MCP servers early so Pi sessions have access to MCP tools.
    // initMcpServers is concurrency-safe: it deduplicates via a promise lock
    // and skips startServers() if the McpServerManager is already running.
    const mcpTools = await initMcpServers();
    console.log(`[Main] initApp: MCP init done, ${mcpTools.length} tools available`);

    bindPiWorkbenchRuntimeForwarder();

    const defaultAgentModelRef = resolveDefaultAgentModelRef();
    const backfilledAgentModels = getCoworkStore().backfillEmptyAgentModels(defaultAgentModelRef);
    const qualifiedAgentModels = migrateAgentModelRefs();
    if (backfilledAgentModels > 0 || qualifiedAgentModels > 0) {
      console.log(
        `[Main] migrated agent model bindings: backfilled=${backfilledAgentModels}, qualified=${qualifiedAgentModels}`,
      );
    }

    // Start proxy BEFORE config sync so proxy-dependent providers (e.g. copilot)
    // get the correct baseURL on the first write, avoiding a mid-startup config
    // overwrite that triggers unnecessary gateway hot-reload.
    profiler.mark('applyProxyPreference');
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));
    profiler.measure('applyProxyPreference');

    profiler.mark('coworkOpenAICompatProxy');
    await startCoworkOpenAICompatProxy().catch(error => {
      console.error('Failed to start OpenAI compatibility proxy:', error);
    });
    profiler.measure('coworkOpenAICompatProxy');

    try {
      getCronJobService().startPolling();
    } catch (error) {
      console.warn('[Main] Canonical scheduler not available after startup:', error);
    }

    // ── Step 1: Show window ASAP ──────────────────────────────────────
    // CSP + createWindow moved before skill initialisation so the user
    // sees the loading UI within ~1-2 s instead of waiting for the full
    // skill bootstrap (~6-8 s previously).
    setContentSecurityPolicy();

    profiler.mark('createWindow');
    console.log('[Main] initApp: creating window');
    createWindow();
    profiler.measure('createWindow');
    console.log('[Main] initApp: window created');
    piModelCatalogRefreshCoordinator.start();
    startAppUpdatePolling();

    // ── Step 2-4: Skill bootstrap (non-blocking) ────────────────────
    console.log('[Main] initApp: starting skill bootstrap');
    profiler.mark('skillManager');
    const manager = getSkillManager();
    console.log('[Main] initApp: getSkillManager done');

    // Inject SKILLS_ROOT into process.env so ALL subprocesses (Pi sessions,
    // shell tools spawned by the agent, skill scripts, etc.) inherit it.
    // Set this globally so Pi sessions and their subprocesses inherit it.
    const skillsRoot = getSkillsRoot().replace(/\\/g, '/');
    process.env.SKILLS_ROOT = skillsRoot;
    process.env.ZHIYUAN_SKILLS_ROOT = skillsRoot;
    console.log('[Main] initApp: SKILLS_ROOT =', skillsRoot);

    // Parallelise independent skill sub-tasks (Step 4).
    await Promise.all([
      // Group A: file-system skill operations (sync, must run in order)
      (async () => {
        profiler.mark('syncBundledSkills');
        try {
          manager.syncBundledSkillsToUserData();
          console.log('[Main] initApp: syncBundledSkillsToUserData done');
        } catch (error) {
          console.error('[Main] initApp: syncBundledSkillsToUserData failed:', error);
        }
        profiler.measure('syncBundledSkills');

        try {
          manager.recoverInterruptedUpgrades();
          console.log('[Main] initApp: recoverInterruptedUpgrades done');
        } catch (error) {
          console.error('[Main] initApp: recoverInterruptedUpgrades failed:', error);
        }

        try {
          manager.startWatching();
          console.log('[Main] initApp: startWatching done');
        } catch (error) {
          console.error('[Main] initApp: startWatching failed:', error);
        }
      })(),

      // Group B: python runtime (independent, async)
      (async () => {
        profiler.mark('pythonRuntime');
        try {
          const runtimeResult = await ensurePythonRuntimeReady();
          if (!runtimeResult.success) {
            console.error('[Main] initApp: ensurePythonRuntimeReady failed:', runtimeResult.error);
          } else {
            console.log('[Main] initApp: ensurePythonRuntimeReady done');
            appendPythonRuntimeToEnv(process.env as Record<string, string | undefined>);
          }
        } catch (error) {
          console.error('[Main] initApp: ensurePythonRuntimeReady threw:', error);
        }
        profiler.measure('pythonRuntime');
      })(),
    ]);

    // Skill services (web-search bridge) — fire-and-forget (Step 2).
    // No IPC handler or downstream init depends on this completing.
    try {
      const skillServices = getSkillServiceManager();
      console.log('[Main] initApp: getSkillServiceManager done');
      const t0 = performance.now();
      void skillServices
        .startAll()
        .then(() => {
          console.log(
            `[Main] initApp: skill services started (background, ${(performance.now() - t0).toFixed(0)}ms)`,
          );
        })
        .catch(error => {
          console.error('[Main] initApp: skill services failed:', error);
        });
    } catch (error) {
      console.error('[Main] initApp: skill services init failed:', error);
    }
    profiler.measure('skillManager');

    console.log(profiler.summary());

    // Windows/Linux cold start: parse deep link from process.argv
    // Always buffer since renderer is not ready yet after createWindow()
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('zhiyuan://'));
    if (coldStartDeepLink) {
      handleDeepLink(coldStartDeepLink);
    }

    powerMonitor.on('resume', () => {
      if (Date.now() - lastSuccessfulAppUpdateCheckAt >= APP_UPDATE_POLL_INTERVAL_MS) {
        checkForAppUpdate();
      }
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      getStore().set('auto_launch_enabled', true);
      setAutoLaunchEnabled(true);
    }

    // Restore prevent-sleep setting
    const preventSleepEnabled = getStore().get<boolean>('prevent_sleep_enabled');
    if (preventSleepEnabled) {
      try {
        setPreventSleepBlockerEnabled(true);
      } catch (err) {
        console.error('[Main] Failed to start prevent-sleep blocker:', err);
      }
    }

    let lastLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
    let lastUseSystemProxy = getUseSystemProxyFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    let lastSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    getStore().onDidChange<AppConfigSettings>('app_config', (newConfig, oldConfig) => {
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(() => mainWindow);
      }

      const previousUseSystemProxy = oldConfig
        ? getUseSystemProxyFromConfig(oldConfig)
        : lastUseSystemProxy;
      const currentUseSystemProxy = getUseSystemProxyFromConfig(newConfig);
      if (currentUseSystemProxy !== previousUseSystemProxy) {
        console.log(
          `[Proxy] system proxy preference changed from ${previousUseSystemProxy} to ${currentUseSystemProxy}`,
        );
        void applyProxyPreference(currentUseSystemProxy);
      }
      lastUseSystemProxy = currentUseSystemProxy;

      const previousSqliteAutoBackupEnabled = oldConfig
        ? getSqliteAutoBackupEnabledFromConfig(oldConfig)
        : lastSqliteAutoBackupEnabled;
      const currentSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(newConfig);
      if (currentSqliteAutoBackupEnabled !== previousSqliteAutoBackupEnabled) {
        if (currentSqliteAutoBackupEnabled) {
          void startSqliteBackupLoop().catch(error => {
            console.error('[SqliteBackup] Failed to enable periodic backup loop:', error);
          });
        } else {
          stopSqliteBackupLoop();
        }
      }
      lastSqliteAutoBackupEnabled = currentSqliteAutoBackupEnabled;
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (!mainWindow.isFocused()) mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      recordAppQuitOrigin(AppQuitOrigin.WindowAllClosed);
      app.quit();
    }
  });
}
