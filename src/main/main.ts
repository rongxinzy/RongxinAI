import crypto from 'crypto';
import { spawn } from 'child_process';
import * as nodeNet from 'node:net';
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

import type { OpenClawSessionPatch } from '../common/openclawSession';
import { buildSessionTitleFromInput } from '../common/sessionTitle';
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
  CoworkPermissionSessionId,
  CoworkPermissionToolName,
  CoworkSessionMode,
} from '../shared/cowork/constants';
import {
  type CoworkSessionExpertInput,
  type CoworkSessionExpertSnapshot,
  CoworkSessionExpertSource,
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
  McpIpc,
  OpenClawBridgeIpc,
  ProjectIpc,
  SkillsIpc,
} from '../shared/ipc/channels';
import {
  CoworkQueueEnqueueSchema,
  CoworkQueueItemSchema,
  CoworkQueueSessionSchema,
  CoworkQueueUpdateSchema,
} from '../shared/ipc/queueSchemas';
import {
  ApiFetchSchema,
  ApiStreamSchema,
  CoworkSessionStartSchema,
  ProjectCreateDirectorySchema,
} from '../shared/ipc/schemas';
import { PlatformRegistry } from '../shared/platform';
import { OpenClawEnginePhase } from '../shared/openclaw/constants';
import { ProviderName } from '../shared/providers';
import { WorkspaceIpc, WorkspaceStoreKey } from '../shared/workspace';
import type { WorkbenchRun, WorkbenchTask } from '../shared/workbenchTask';
import { AgentManager } from './agentManager';
import { EngramManager } from './memory/engramManager';
import { ProjectMemoryService } from './memory/projectMemoryService';
import { MemoryRepository } from './memory/repository';
import { ZhiYuanEngramAdapter } from './memory/zhiyuanEngramAdapter';
import { registerMemoryIpcHandlers } from './memory/ipc';
import { promoteVerifiedWorkbenchRun } from './memory/taskMemoryPromotion';
import { searchAnySearchGateway } from './libs/anysearchGateway';
import {
  resolveAnySearchGatewayToken,
  resolveAnySearchGatewayUrl,
} from './libs/anysearchGatewayCredentials';
import { APP_DATA_DIR_NAME, APP_NAME, DB_FILENAME } from './appConstants';
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
import { IMGatewayConfig, IMGatewayManager } from './im';
import {
  approvePairingCode,
  listPairingRequests,
  readAllowFromStore,
  rejectPairingRequest,
} from './im/imPairingStore';
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
import { registerOpenClawBridgeIpcHandlers } from './ipcHandlers/openClawBridge';
import { registerProviderModelDiscoveryIpcHandler } from './ipcHandlers/providerModelDiscovery';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from './ipcHandlers/scheduledTask';
import { getTriageConfig, registerTriageIpcHandlers } from './ipcHandlers/triage';
import { registerWorkbenchTaskIpcHandlers } from './workbenchTask/ipc';
import { WorkbenchTaskService } from './workbenchTask/taskService';
import {
  OpenClawChannelGateway,
  type PermissionResult,
  PiRuntimeAdapter,
} from './libs/agentEngine';
import { AppUpdateCoordinator } from './libs/appUpdateCoordinator';
import {
  getCurrentApiConfig,
  getLlamaCppModelContextWindow,
  getLlamaCppModelOpenClawEligibility,
  isLlamaCppModelRunning,
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
  generateSessionTitle,
  getSkillsRoot,
  probeCoworkModelReadiness,
} from './libs/coworkUtil';
import { resolveBundledNpmRuntime, NpmCli } from './libs/npmRuntime';
import { refreshEndpointsTestMode } from './libs/endpoints';
import {
  mergeEnterpriseOpenclawConfig,
  resolveEnterpriseConfigPath,
  syncEnterpriseConfig,
} from './libs/enterpriseConfigSync';
import { LlamaCppManager } from './libs/llamacppManager';
import { CcConnectBridgeServer } from './libs/ccConnectBridgeServer';
import { serializeCcConnectCronSidecarConfig, serializeCcConnectSidecarConfig } from './libs/ccConnectSidecarConfig';
import { listCcConnectAccountConfigs } from './libs/ccConnectAccountConfig';
import { CcConnectSidecarManager } from './libs/ccConnectSidecarManager';
import { LlamaCppOpenClawEligibilityReason } from './libs/llamacppOpenClawBinding';
import { MCP_OAUTH_STORE_PREFIX, McpOAuthManager } from './libs/mcpOAuthManager';
import { generateCorrelationId, runWithCorrelationId } from './libs/logCorrelation';
import { exportLogsZip } from './libs/logExport';
import { McpBridgeServer } from './libs/mcpBridgeServer';
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
import { parsePrimaryModelRef, resolveQualifiedAgentModelRef } from './libs/openclawAgentModels';
import { consumePendingLocalInferenceInstall } from './libs/pendingLocalInferenceInstall';
import {
  buildManagedSessionKey,
  DEFAULT_MANAGED_AGENT_ID,
  OpenClawChannelSessionSync,
} from './libs/openclawChannelSessionSync';
import type { McpBridgeConfig } from './libs/openclawConfigSync';
import { buildProviderSelection, OpenClawConfigSync } from './libs/openclawConfigSync';
import { OpenClawEngineManager, type OpenClawEngineStatus } from './libs/openclawEngineManager';
import {
  addMemoryEntry,
  deleteMemoryEntry,
  ensureDefaultIdentity,
  getMainAgentWorkspacePath,
  type MemorySource,
  migrateSqliteToMemoryMd,
  readBootstrapFile,
  readMemoryEntries,
  resolveMemoryFilePath,
  searchMemoryEntries,
  updateMemoryEntry,
  writeBootstrapFile,
} from './libs/openclawMemoryFile';
import { migrateMainAgentWorkspace } from './libs/openclawWorkspaceMigration';
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
import { OpenClawSessionIpc } from './openclawSession/constants';
import { CcConnectPiBridge } from './im/ccConnectPiBridge';
import { IMStore } from './im/imStore';
import { OpenClawSessionPolicyIpc } from './openclawSessionPolicy/constants';
import {
  loadOpenClawSessionPolicyConfig,
  saveOpenClawSessionPolicyConfig,
} from './openclawSessionPolicy/store';
import { configureRendererStartup } from './rendererStartup';
import { SkillManager } from './skillManager';
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

const gwDiagTs = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const tz = d.getTimezoneOffset();
  const sign = tz <= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  return `[GW-RESTART-DIAG] ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
};

// 设置应用程序名称
app.name = APP_NAME;
app.setName(APP_NAME);

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_UPDATE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
import { ENGINE_NOT_READY_CODE } from '../common/coworkError';
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

function sanitizeOptionalPatchValue(
  value: unknown,
  maxChars = IPC_STRING_MAX_CHARS,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('Session patch value must be a string or null.');
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error('Session patch value is too long.');
  }
  return trimmed;
}

function sanitizeOpenClawSessionPatch(input: unknown): OpenClawSessionPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid session patch payload.');
  }

  const source = input as Record<string, unknown>;
  const patch: OpenClawSessionPatch = {};

  const model = sanitizeOptionalPatchValue(source.model);
  if (model !== undefined) patch.model = model;

  const thinkingLevel = sanitizeOptionalPatchValue(source.thinkingLevel);
  if (thinkingLevel !== undefined) patch.thinkingLevel = thinkingLevel;

  const reasoningLevel = sanitizeOptionalPatchValue(source.reasoningLevel);
  if (reasoningLevel !== undefined) patch.reasoningLevel = reasoningLevel;

  const elevatedLevel = sanitizeOptionalPatchValue(source.elevatedLevel);
  if (elevatedLevel !== undefined) patch.elevatedLevel = elevatedLevel;

  const responseUsage = sanitizeOptionalPatchValue(source.responseUsage);
  if (responseUsage !== undefined)
    patch.responseUsage = responseUsage as OpenClawSessionPatch['responseUsage'];

  const sendPolicy = sanitizeOptionalPatchValue(source.sendPolicy);
  if (sendPolicy !== undefined) patch.sendPolicy = sendPolicy as OpenClawSessionPatch['sendPolicy'];

  if (Object.keys(patch).length === 0) {
    throw new Error('Session patch is empty.');
  }

  return patch;
}

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const resolveDefaultAgentModelRef = (): string => {
  const apiResolution = resolveRawApiConfig();
  const config = apiResolution.config;
  if (!config?.model?.trim()) {
    return '';
  }

  return buildProviderSelection({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    modelId: config.model.trim(),
    apiType: config.apiType,
    providerName: apiResolution.providerMetadata?.providerName,
    authType: apiResolution.providerMetadata?.authType,
    codingPlanEnabled: apiResolution.providerMetadata?.codingPlanEnabled,
    supportsImage: apiResolution.providerMetadata?.supportsImage,
    modelName: apiResolution.providerMetadata?.modelName,
  }).primaryModel;
};

const buildAvailableOpenClawProviders = (): Record<string, { models: Array<{ id: string }> }> => {
  const providerMap: Record<string, { models: Array<{ id: string }> }> = {};

  for (const provider of resolveAllEnabledProviderConfigs()) {
    for (const model of provider.models) {
      const selection = buildProviderSelection({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        modelId: model.id,
        apiType: provider.apiType,
        providerName: provider.providerName,
        authType: provider.authType,
        codingPlanEnabled: provider.codingPlanEnabled,
        supportsImage: model.supportsImage,
        modelName: model.name,
      });

      if (!providerMap[selection.providerId]) {
        providerMap[selection.providerId] = { models: [] };
      }
      if (
        !providerMap[selection.providerId].models.some(
          entry => entry.id === selection.sessionModelId,
        )
      ) {
        providerMap[selection.providerId].models.push({ id: selection.sessionModelId });
      }
    }
  }

  return providerMap;
};

const normalizeOpenClawModelRef = (modelRef: string): string => {
  const normalized = modelRef.trim();
  if (!normalized) return normalized;

  const qualification = resolveQualifiedAgentModelRef({
    agentModel: normalized,
    availableProviders: buildAvailableOpenClawProviders(),
  });

  return qualification.status === 'qualified' ? qualification.primaryModel : normalized;
};

const validateSessionModelAvailability = (
  modelRef: string,
): { available: boolean; message?: string } => {
  const parsed = parsePrimaryModelRef(modelRef);
  if (!parsed || parsed.providerId !== ProviderName.LlamaCpp) {
    return { available: true };
  }

  if (!isLlamaCppModelRunning(parsed.modelId)) {
    return {
      available: false,
      message: t('coworkLlamaCppModelNotRunning'),
    };
  }

  const eligibility = getLlamaCppModelOpenClawEligibility(parsed.modelId);
  if (!eligibility) {
    return {
      available: false,
      message: t('coworkLlamaCppContextWindowUnknown'),
    };
  }

  if (!eligibility.eligible) {
    if (eligibility.reason === LlamaCppOpenClawEligibilityReason.TrainedContextTooSmall) {
      return {
        available: false,
        message: t('coworkLlamaCppTrainingContextTooSmall')
          .replace('{trained}', String(eligibility.trainedContextWindow ?? 0))
          .replace('{required}', String(eligibility.requiredContextWindow)),
      };
    }

    if (eligibility.reason === LlamaCppOpenClawEligibilityReason.RuntimeContextTooSmall) {
      return {
        available: false,
        message: t('coworkLlamaCppContextWindowTooSmall')
          .replace('{current}', String(eligibility.runtimeContextWindow ?? 0))
          .replace('{required}', String(eligibility.requiredContextWindow)),
      };
    }

    return {
      available: false,
      message: t('coworkLlamaCppContextWindowUnknown'),
    };
  }

  return { available: true };
};

const migrateAgentModelRefs = (): number => {
  const defaultModelRef = resolveDefaultAgentModelRef();
  if (!defaultModelRef) return 0;

  const availableProviders = buildAvailableOpenClawProviders();
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

const OPENCLAW_DAILY_LOG_RETENTION_DAYS = 7;
const OPENCLAW_DAILY_LOG_RE = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;

function getRecentOpenClawDailyLogEntries(
  logDir: string | null,
): Array<{ archiveName: string; filePath: string }> {
  if (!logDir || !fs.existsSync(logDir)) return [];

  const cutoffMs = Date.now() - OPENCLAW_DAILY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return fs
    .readdirSync(logDir)
    .filter(f => OPENCLAW_DAILY_LOG_RE.test(f))
    .map(f => ({ archiveName: f, filePath: path.join(logDir, f) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

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
    const { imageAttachments, ...rest } = messageRecord.metadata as Record<string, unknown>;
    const sanitizedRest = sanitizeIpcPayload(rest) as Record<string, unknown> | undefined;
    sanitizedMetadata = {
      ...(sanitizedRest && typeof sanitizedRest === 'object' ? sanitizedRest : {}),
      ...(Array.isArray(imageAttachments) && imageAttachments.length > 0
        ? { imageAttachments }
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
  // and some agent engines (OpenClaw) also fail when given a drive root as workspace.
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
  console.error('Render process gone:', details);
  const shouldReload =
    details.reason === 'crashed' ||
    details.reason === 'killed' ||
    details.reason === 'oom' ||
    details.reason === 'launch-failed' ||
    details.reason === 'integrity-failure';
  if (shouldReload) {
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
let openClawChannelGateway: OpenClawChannelGateway | null = null;
let piRuntimeAdapter: PiRuntimeAdapter | null = null;
let workbenchTaskService: WorkbenchTaskService | null = null;
let engramManager: EngramManager | null = null;
let engramAdapter: ZhiYuanEngramAdapter | null = null;
let memoryRepository: MemoryRepository | null = null;
let projectMemoryService: ProjectMemoryService | null = null;

const getWorkbenchTaskService = (): WorkbenchTaskService => {
  if (!workbenchTaskService) {
    workbenchTaskService = new WorkbenchTaskService(getStore().getDatabase(), {
      onVerifiedRun: event => {
        promoteVerifiedWorkbenchRun(getProjectMemoryService(), event);
      },
    });
  }
  return workbenchTaskService;
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
    // mcpServerManager is created async later (ensureOpenClawRunningForCowork),
    // so it is always null here. Late-injection happens on every subsequent call.
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
let mcpBridgeServer: McpBridgeServer | null = null;
// Generated eagerly so the secret is available before the first syncOpenClawConfig
// call — the gateway process inherits it via ZHIYUAN_MCP_BRIDGE_SECRET env var at
// spawn time, avoiding a restart just to pick up the correct secret.
let mcpBridgeSecret: string = require('crypto').randomUUID();
let mcpBridgeStartPromise: Promise<McpBridgeConfig | null> | null = null;
let mcpInitPromise: Promise<McpToolManifestEntry[]> | null = null;
let mcpLifecycleGeneration = 0;
const activeMcpAuthorizations = new Map<string, AbortController>();
let imGatewayManager: IMGatewayManager | null = null;
let ccConnectBridgeServer: CcConnectBridgeServer | null = null;
let ccConnectSidecarManager: CcConnectSidecarManager | null = null;
const ccConnectChannelSidecarManagers = new Map<string, CcConnectSidecarManager>();
const ccConnectChannelRestartTimers = new Map<string, NodeJS.Timeout>();
let ccConnectChannelSidecarsStopping = false;
let ccConnectPiBridge: CcConnectPiBridge | null = null;
let canonicalScheduledTaskService: CanonicalScheduledTaskService | null = null;
let canonicalSchedulerRuntime: CcConnectSchedulerRuntime | null = null;
let deferredCcConnectCronClient: DeferredCcConnectCronClient | null = null;
let ccConnectDeliveryTransport: CcConnectDeliveryTransport | null = null;
let ccConnectBridgeToken: string | null = null;
let ccConnectBridgeUrl: string | null = null;
let schedulerClockRestartTimer: NodeJS.Timeout | null = null;
let schedulerClockRestartAttempts = 0;
const attachCcConnectCronControl = async (accountId: string, baseUrl: string): Promise<void> => {
  if (!ccConnectBridgeToken) throw new Error('cc-connect bridge token is not initialized');
  getCanonicalScheduledTaskService();
  const client = new CcConnectCronClient(baseUrl, ccConnectBridgeToken);
  await client.healthCheck();
  await deferredCcConnectCronClient!.attach(accountId, client);
  // The sidecar intentionally has no durable task state. Rebuild its complete
  // trigger projection from SQLite after every successful control-plane attach.
  await canonicalSchedulerRuntime!.reconcile(await getCanonicalScheduledTaskService().listJobs());
};
const getCanonicalScheduledTaskService = (): CanonicalScheduledTaskService => {
  if (!canonicalScheduledTaskService) {
    const taskStore = new SqliteScheduledTaskStore(getStore().getDatabase());
    deferredCcConnectCronClient = new DeferredCcConnectCronClient();
    ccConnectDeliveryTransport = new CcConnectDeliveryTransport(new IMStore(getStore().getDatabase()));
    const executor = new PiScheduledTaskExecutor(getPiRuntimeAdapter(), getCoworkStore());
    canonicalSchedulerRuntime = new CcConnectSchedulerRuntime(
      taskStore,
      deferredCcConnectCronClient,
      executor.execute.bind(executor),
      new ScheduledTaskDeliveryDispatcher(taskStore, ccConnectDeliveryTransport),
    );
    canonicalScheduledTaskService = new CanonicalScheduledTaskService(taskStore, canonicalSchedulerRuntime);
  }
  return canonicalScheduledTaskService;
};
const startCcConnectBridge = async (): Promise<void> => {
  if (ccConnectBridgeServer) return;
  const token = crypto.randomBytes(32).toString('base64url');
  ccConnectBridgeToken = token;
  ccConnectPiBridge = new CcConnectPiBridge({
    runtime: getPiRuntimeAdapter(), coworkStore: getCoworkStore(),
    imStore: new IMStore(getStore().getDatabase()),
    getSkillsPrompt: async () => getSkillManager().buildAutoRoutingPrompt(),
    onCronTrigger: async trigger => getCanonicalScheduledTaskService() && canonicalSchedulerRuntime!.handleTrigger({
      accountId: trigger.project,
      taskId: trigger.taskId,
      scheduleVersion: trigger.scheduleVersion,
      scheduledAt: trigger.scheduledAt,
    }),
  });
  ccConnectBridgeServer = new CcConnectBridgeServer(token, {
    onTurn: request => ccConnectPiBridge!.runTurn(request),
    onCronTrigger: trigger => ccConnectPiBridge!.runCronTrigger(trigger),
  });
  ccConnectBridgeUrl = await ccConnectBridgeServer.start();
};

const findAvailableLoopbackPort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = nodeNet.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Unable to reserve a cc-connect cron control port'));
      return;
    }
    server.close(error => error ? reject(error) : resolve(address.port));
  });
});

const resolveCcConnectSidecarExecutable = (): string | null => {
  const binary = process.platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const candidates = [
    path.join(process.resourcesPath, 'channel-runtime', binary),
    path.join(app.getAppPath(), 'vendor', 'channel-runtime', 'current', binary),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
};

const waitForCcConnectCronControl = async (accountId: string, baseUrl: string): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await attachCcConnectCronControl(accountId, baseUrl);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('cc-connect cron control did not become ready');
};

const waitForCcConnectDeliveryControl = async (accountId: string, baseUrl: string): Promise<void> => {
  if (!ccConnectBridgeToken) throw new Error('cc-connect bridge token is not initialized');
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const client = new CcConnectDeliveryClient(baseUrl, ccConnectBridgeToken);
      // Health is shared with the trigger-only control plane. Channel processes
      // are delivery transports, never canonical scheduler clocks.
      await new CcConnectCronClient(baseUrl, ccConnectBridgeToken).healthCheck();
      ccConnectDeliveryTransport?.attach(accountId, client);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`cc-connect delivery control did not become ready for ${accountId}`);
};

/** Starts the credential-free canonical scheduler clock used by default tasks. */
const startCanonicalSchedulerClock = async (): Promise<void> => {
  if (ccConnectSidecarManager) return;
  if (!ccConnectBridgeToken || !ccConnectBridgeUrl) throw new Error('cc-connect bridge is not initialized');
  const executable = resolveCcConnectSidecarExecutable();
  if (!executable) {
    console.warn('[Scheduler] cc-connect sidecar is not bundled; canonical scheduler clock is unavailable');
    return;
  }
  const port = await findAvailableLoopbackPort();
  const sidecarRoot = path.join(app.getPath('userData'), 'cc-connect', 'scheduler-default');
  const manager = new CcConnectSidecarManager(executable, path.join(sidecarRoot, 'config.toml'));
  manager.on('error', error => console.error('[Scheduler] cc-connect sidecar error:', error));
  manager.on('exit', ({ code, signal }) => {
    deferredCcConnectCronClient?.detach(SchedulerClockAccount);
    ccConnectSidecarManager = null;
    console.warn(`[Scheduler] cc-connect sidecar exited (code=${code}, signal=${signal})`);
    scheduleCanonicalSchedulerClockRestart();
  });
  ccConnectSidecarManager = manager;
  try {
    await manager.start(serializeCcConnectCronSidecarConfig({
      dataDir: sidecarRoot,
      bridgeUrl: ccConnectBridgeUrl,
      bridgeToken: ccConnectBridgeToken,
      cronControlListen: `127.0.0.1:${port}`,
      accountId: SchedulerClockAccount,
    }));
  await waitForCcConnectCronControl(SchedulerClockAccount, `http://127.0.0.1:${port}`);
    schedulerClockRestartAttempts = 0;
  } catch (error) {
    ccConnectSidecarManager = null;
    await manager.stop();
    throw error;
  }
};

const startCcConnectChannelSidecar = async (account: ReturnType<typeof listCcConnectAccountConfigs>[number]): Promise<void> => {
  if (ccConnectChannelSidecarManagers.has(account.accountId)) return;
  if (!ccConnectBridgeToken || !ccConnectBridgeUrl) throw new Error('cc-connect bridge is not initialized');
  const executable = resolveCcConnectSidecarExecutable();
  if (!executable) return;
  const port = await findAvailableLoopbackPort();
  const sidecarRoot = path.join(app.getPath('userData'), 'cc-connect', 'accounts', account.accountId);
  const manager = new CcConnectSidecarManager(executable, path.join(sidecarRoot, 'config.toml'));
  manager.on('error', error => console.error(`[cc-connect] ${account.accountId} sidecar error:`, error));
  manager.on('exit', ({ code, signal }) => {
    ccConnectChannelSidecarManagers.delete(account.accountId);
    ccConnectDeliveryTransport?.detach(account.accountId);
    console.warn(`[cc-connect] ${account.accountId} sidecar exited (code=${code}, signal=${signal})`);
    if (ccConnectChannelSidecarsStopping || !ccConnectBridgeServer || ccConnectChannelRestartTimers.has(account.accountId)) return;
    const timer = setTimeout(() => {
      ccConnectChannelRestartTimers.delete(account.accountId);
      void startCcConnectChannelSidecar(account).catch(error =>
        console.error(`[cc-connect] Failed to restart ${account.accountId} sidecar:`, error),
      );
    }, 1_000);
    ccConnectChannelRestartTimers.set(account.accountId, timer);
  });
  ccConnectChannelSidecarManagers.set(account.accountId, manager);
  try {
    await manager.start(serializeCcConnectSidecarConfig({
      dataDir: sidecarRoot,
      bridgeUrl: ccConnectBridgeUrl,
      bridgeToken: ccConnectBridgeToken,
      cronControlListen: `127.0.0.1:${port}`,
      projects: [account],
    }));
    await waitForCcConnectDeliveryControl(account.accountId, `http://127.0.0.1:${port}`);
  } catch (error) {
    ccConnectChannelSidecarManagers.delete(account.accountId);
    ccConnectDeliveryTransport?.detach(account.accountId);
    await manager.stop();
    throw error;
  }
};

const startCcConnectChannelSidecars = async (): Promise<void> => {
  const accounts = listCcConnectAccountConfigs(new IMStore(getStore().getDatabase()));
  await Promise.all(accounts.map(account => startCcConnectChannelSidecar(account)));
};

/** Re-read account settings without ever starting the legacy OpenClaw channels. */
const reconcileCcConnectChannelSidecars = async (): Promise<void> => {
  ccConnectChannelSidecarsStopping = true;
  for (const timer of ccConnectChannelRestartTimers.values()) clearTimeout(timer);
  ccConnectChannelRestartTimers.clear();
  await Promise.all(Array.from(ccConnectChannelSidecarManagers.values(), manager => manager.stop()));
  ccConnectChannelSidecarManagers.clear();
  ccConnectChannelSidecarsStopping = false;
  await startCcConnectChannelSidecars();
};

const scheduleCanonicalSchedulerClockRestart = (): void => {
  if (schedulerClockRestartTimer || !ccConnectBridgeServer) return;
  const delayMs = Math.min(30_000, 1_000 * 2 ** schedulerClockRestartAttempts);
  schedulerClockRestartAttempts = Math.min(schedulerClockRestartAttempts + 1, 5);
  schedulerClockRestartTimer = setTimeout(() => {
    schedulerClockRestartTimer = null;
    void startCanonicalSchedulerClock().catch(error => {
      console.error('[Scheduler] Failed to restart canonical cc-connect clock:', error);
      scheduleCanonicalSchedulerClockRestart();
    });
  }, delayMs);
};
let storeInitPromise: Promise<SqliteStore> | null = null;
let sqliteBackupManager: SqliteBackupManager | null = null;
let openClawEngineManager: OpenClawEngineManager | null = null;
let llamaCppManager: LlamaCppManager | null = null;
let ollamaManager: OllamaManager | null = null;
let openClawConfigSync: OpenClawConfigSync | null = null;
let openClawBootstrapPromise: Promise<OpenClawEngineStatus> | null = null;
let openClawStatusForwarderBound = false;
let piWorkbenchRuntimeForwarderBound = false;
let memoryMigrationDone = false;
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

const getOpenClawEngineManager = (): OpenClawEngineManager => {
  if (!openClawEngineManager) {
    openClawEngineManager = new OpenClawEngineManager();
  }
  return openClawEngineManager;
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

const forwardOpenClawStatus = (status: OpenClawEngineStatus): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send('openclaw:engine:onProgress', status);
    } catch (error) {
      console.error('Failed to forward OpenClaw engine status:', error);
    }
  });
};

const bindOpenClawStatusForwarder = (): void => {
  if (openClawStatusForwarderBound) return;
  const manager = getOpenClawEngineManager();
  manager.on('status', status => {
    forwardOpenClawStatus(status);
  });
  openClawStatusForwarderBound = true;
  forwardOpenClawStatus(manager.getStatus());
};

const bootstrapOpenClawEngine = async (
  options: { forceReinstall?: boolean; reason?: string } = {},
) => {
  if (openClawBootstrapPromise) {
    return openClawBootstrapPromise;
  }

  const manager = getOpenClawEngineManager();
  bindOpenClawStatusForwarder();

  const task = async (): Promise<OpenClawEngineStatus> => {
    const reason = options.reason || 'unknown';
    const t0 = Date.now();
    const elapsed = () => `${Date.now() - t0}ms`;
    try {
      console.log(`[OpenClaw] bootstrap starting (reason=${reason})`);

      // Start MCP Bridge before config sync so mcpBridge tools are included in openclaw.json
      const bridgeResult = await startMcpBridge().catch((err: unknown) => {
        console.error(`[OpenClaw] bootstrap: MCP bridge startup failed (non-fatal):`, err);
        return null as McpBridgeConfig | null;
      });
      console.log(
        `[OpenClaw] bootstrap: MCP bridge setup done (${elapsed()}), result=${bridgeResult ? `${bridgeResult.tools.length} tools` : 'null'}`,
      );
      console.log(
        `[OpenClaw] bootstrap: mcpBridgeServer=${mcpBridgeServer?.callbackUrl || 'null'}, mcpServerManager.tools=${mcpServerManager?.toolManifest?.length ?? 'null'}, secret=${mcpBridgeSecret ? 'set' : 'null'}`,
      );

      // Ensure IDENTITY.md has default content in the main agent workspace
      try {
        ensureDefaultIdentity(getMainAgentWorkspacePath(manager.getStateDir()));
      } catch (err) {
        console.warn('[OpenClaw] bootstrap: ensureDefaultIdentity failed (non-fatal):', err);
      }

      const syncResult = await syncOpenClawConfig({
        reason: `bootstrap:${reason}`,
        restartGatewayIfRunning: false,
      });
      console.log(
        `[OpenClaw] bootstrap: syncOpenClawConfig done (${elapsed()}), success=${syncResult.success}`,
      );
      if (!syncResult.success) {
        return syncResult.status || manager.getStatus();
      }
      if (options.forceReinstall) {
        console.log(
          `${gwDiagTs()} bootstrap: forceReinstall requested, stopping gateway before reinstall`,
        );
        await manager.stopGateway();
        console.log(`[OpenClaw] bootstrap: stopGateway done (${elapsed()})`);
      }
      const ensuredStatus = await manager.ensureReady();
      console.log(
        `[OpenClaw] bootstrap: ensureReady done (${elapsed()}), phase=${ensuredStatus.phase}`,
      );
      if (ensuredStatus.phase !== 'ready' && ensuredStatus.phase !== 'running') {
        return ensuredStatus;
      }
      const result = await manager.startGateway(`bootstrap:${reason}`);
      console.log(`[OpenClaw] bootstrap completed (${elapsed()}), phase=${result.phase}`);
      return result;
    } catch (error) {
      console.error(`[OpenClaw] bootstrap failed (${reason}, ${elapsed()}):`, error);
      return manager.getStatus();
    }
  };

  const promise = task().finally(() => {
    if (openClawBootstrapPromise === promise) {
      openClawBootstrapPromise = null;
    }
  });
  openClawBootstrapPromise = promise;
  return promise;
};

const ensureOpenClawRunningForCowork = async () => {
  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase === 'running') {
    return manager.getStatus();
  }
  if (status.phase === 'starting') {
    return status;
  }

  // Ensure MCP bridge is started and config is synced before launching the gateway,
  // so that mcpBridge tools are available in openclaw.json when the gateway loads.
  await startMcpBridge().catch((err: unknown) => {
    console.error('[OpenClaw] ensureRunning: MCP bridge startup failed (non-fatal):', err);
  });
  const syncResult = await syncOpenClawConfig({
    reason: 'ensureRunning:mcpBridge',
    restartGatewayIfRunning: false,
  });
  if (!syncResult.success) {
    console.error('[OpenClaw] ensureRunning: config sync failed:', syncResult.error);
  }

  console.log(`${gwDiagTs()} ensureRunning: gateway not running (phase=${status.phase}), starting`);
  return await manager.startGateway('ensure-running-for-cowork');
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

const resolveAgentDefaultWorkingDirectory = (agentId?: string): string => {
  const resolvedAgentId = agentId?.trim() || 'main';
  const agentWorkingDirectory = getAgentManager()
    .getAgent(resolvedAgentId)
    ?.workingDirectory?.trim();
  if (agentWorkingDirectory) return agentWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

const resolveSessionWorkingDirectory = (options: { cwd?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

const getOpenClawConfigSync = (): OpenClawConfigSync => {
  if (!openClawConfigSync) {
    openClawConfigSync = new OpenClawConfigSync({
      engineManager: getOpenClawEngineManager(),
      getCoworkConfig: () => getCoworkStore().getConfig(),
      isEnterprise: () => !!getStore().get('enterprise_config'),
      getOpenClawSessionPolicy: () => loadOpenClawSessionPolicyConfig(getStore()),
      getSkillsList: () =>
        getSkillManager()
          .listSkills()
          .map(s => ({ id: s.id, enabled: s.enabled })),
      getTelegramInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getTelegramInstances();
        } catch {
          return [];
        }
      },
      getDingTalkInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getDingTalkInstances();
        } catch {
          return [];
        }
      },
      getFeishuInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getFeishuInstances();
        } catch {
          return [];
        }
      },
      getQQInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getQQInstances();
        } catch {
          return [];
        }
      },
      getWecomInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getWecomInstances();
        } catch {
          return [];
        }
      },
      getWeixinConfig: () => {
        try {
          return getIMGatewayManager().getConfig().weixin;
        } catch {
          return null;
        }
      },
      getIMSettings: () => {
        try {
          return getIMGatewayManager().getConfig().settings;
        } catch {
          return null;
        }
      },
      getDiscordInstances: () => {
        try {
          return getIMGatewayManager()?.getIMStore()?.getDiscordInstances() ?? [];
        } catch {
          return [];
        }
      },
      getMcpBridgeConfig: (): McpBridgeConfig | null => {
        if (
          !mcpBridgeServer?.callbackUrl ||
          !mcpBridgeServer?.askUserCallbackUrl ||
          !mcpBridgeSecret
        ) {
          return null;
        }
        return {
          callbackUrl: mcpBridgeServer.callbackUrl,
          askUserCallbackUrl: mcpBridgeServer.askUserCallbackUrl,
          secret: mcpBridgeSecret,
          tools: mcpServerManager?.toolManifest ?? [],
        };
      },
      getMcpBridgeSecret: () => mcpBridgeSecret,
      getAgents: () => getCoworkStore().listAgents(),
    });
  }
  return openClawConfigSync;
};

// Deferred gateway restart: when a config change requires a gateway restart
// but active cowork sessions or cron jobs exist, we defer the restart until
// all workloads complete.  A polling interval checks periodically; a hard
// timeout ensures the restart eventually happens even if a session hangs.
let deferredRestartTimer: ReturnType<typeof setInterval> | null = null;
let deferredRestartTimeout: ReturnType<typeof setTimeout> | null = null;
const DEFERRED_RESTART_POLL_MS = 3_000;
const DEFERRED_RESTART_MAX_WAIT_MS = 5 * 60_000; // 5 minutes hard cap

const hasActiveGatewayWorkloads = (): boolean => {
  if (openClawChannelGateway?.hasActiveSessions()) return true;
  try {
    if (getCronJobService()?.hasRunningJobs()) return true;
  } catch {
    // The canonical scheduler may not be initialized yet.
  }
  return false;
};

const clearDeferredRestart = () => {
  if (deferredRestartTimer) {
    clearInterval(deferredRestartTimer);
    deferredRestartTimer = null;
  }
  if (deferredRestartTimeout) {
    clearTimeout(deferredRestartTimeout);
    deferredRestartTimeout = null;
  }
};

const executeDeferredGatewayRestart = async (reason: string) => {
  clearDeferredRestart();
  console.log(
    `${gwDiagTs()} executeDeferredGatewayRestart: performing deferred restart (reason: ${reason})`,
  );
  await syncOpenClawConfig({ reason: `deferred:${reason}` });
};

const scheduleDeferredGatewayRestart = (reason: string) => {
  // If already scheduled, the latest config is already on disk — just let
  // the existing timer handle the restart.
  if (deferredRestartTimer) {
    console.log(
      `${gwDiagTs()} scheduleDeferredGatewayRestart: already scheduled, skipping (reason: ${reason})`,
    );
    return;
  }

  console.log(
    `${gwDiagTs()} scheduleDeferredGatewayRestart: scheduling deferred restart, polling every ${DEFERRED_RESTART_POLL_MS}ms, max wait ${DEFERRED_RESTART_MAX_WAIT_MS}ms (reason: ${reason})`,
  );
  deferredRestartTimer = setInterval(() => {
    if (!hasActiveGatewayWorkloads()) {
      void executeDeferredGatewayRestart(reason);
    }
  }, DEFERRED_RESTART_POLL_MS);

  // Hard timeout: restart anyway after max wait to avoid config drift.
  deferredRestartTimeout = setTimeout(() => {
    console.warn(
      `${gwDiagTs()} scheduleDeferredGatewayRestart: max wait exceeded, forcing restart (reason: ${reason})`,
    );
    void executeDeferredGatewayRestart(reason);
  }, DEFERRED_RESTART_MAX_WAIT_MS);
};

// Debounce state for syncOpenClawConfig (Phase 1 / O4).
// Merges rapid successive calls within a 500ms window to avoid redundant
// config writes and restart evaluations.  Only the *last* call's options
// are used for the debounced execution (except restartGatewayIfRunning,
// which is OR-merged so no request is silently dropped).
let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _syncDebouncePromise: Promise<{
  success: boolean;
  changed: boolean;
  mcpBridgeConfigChanged?: boolean;
  status?: OpenClawEngineStatus;
  error?: string;
}> | null = null;
let _syncDebounceOptions: {
  reason: string;
  restartGatewayIfRunning?: boolean;
  forceGatewayRestartIfRunning?: boolean;
} | null = null;
const SYNC_DEBOUNCE_MS = 500;

const syncOpenClawConfig = async (
  options: {
    reason: string;
    restartGatewayIfRunning?: boolean;
    forceGatewayRestartIfRunning?: boolean;
  } = { reason: 'unknown' },
): Promise<{
  success: boolean;
  changed: boolean;
  mcpBridgeConfigChanged?: boolean;
  status?: OpenClawEngineStatus;
  error?: string;
}> => {
  // Debounce: merge non-startup calls within SYNC_DEBOUNCE_MS.
  if (options.reason !== 'startup') {
    if (_syncDebouncePromise) {
      // Merge restartGatewayIfRunning flag so no request is silently dropped.
      if (options.restartGatewayIfRunning && _syncDebounceOptions) {
        _syncDebounceOptions.restartGatewayIfRunning = true;
      }
      if (options.forceGatewayRestartIfRunning && _syncDebounceOptions) {
        _syncDebounceOptions.forceGatewayRestartIfRunning = true;
      }
      return _syncDebouncePromise;
    }

    _syncDebounceOptions = { ...options };

    _syncDebouncePromise = new Promise(resolve => {
      if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
      _syncDebounceTimer = setTimeout(async () => {
        try {
          const result = await doSyncOpenClawConfig(_syncDebounceOptions!);
          resolve(result);
        } finally {
          _syncDebounceTimer = null;
          _syncDebouncePromise = null;
          _syncDebounceOptions = null;
        }
      }, SYNC_DEBOUNCE_MS);
    });

    return _syncDebouncePromise;
  }

  // Startup calls execute immediately — the gateway isn't running yet
  // and we need the config written before anything else (Phase 1 / O1).
  return doSyncOpenClawConfig(options);
};

const doSyncOpenClawConfig = async (options: {
  reason: string;
  restartGatewayIfRunning?: boolean;
  forceGatewayRestartIfRunning?: boolean;
}): Promise<{
  success: boolean;
  changed: boolean;
  mcpBridgeConfigChanged?: boolean;
  status?: OpenClawEngineStatus;
  error?: string;
}> => {
  const D = gwDiagTs;
  console.log(
    `${D()} ──── syncOpenClawConfig START reason=${options.reason} restartIfRunning=${!!options.restartGatewayIfRunning} forceRestart=${!!options.forceGatewayRestartIfRunning}`,
  );

  const syncResult = getOpenClawConfigSync().sync(options.reason);
  console.log(
    `${D()} sync() ok=${syncResult.ok} changed=${syncResult.changed} bindingsChanged=${!!syncResult.bindingsChanged}`,
  );
  if (!syncResult.ok) {
    console.log(`${D()} sync FAILED: ${syncResult.error}`);
    const status = getOpenClawEngineManager().setExternalError(
      `OpenClaw config sync failed: ${syncResult.error || 'unknown error'}`,
    );
    return {
      success: false,
      changed: false,
      status,
      error: syncResult.error,
    };
  }

  try {
    mergeEnterpriseOpenclawConfig(getOpenClawEngineManager().getConfigPath());
  } catch {
    /* non-critical */
  }

  // Fast path: when the gateway is not running, skip the env-var diff
  // diagnostic logging and restart-decision logic.  The config file has
  // already been written by sync() above; we only need to seed the
  // secret-env-var state so that the next sync (after gateway start) does
  // not spuriously detect a change.
  //
  // This saves ~1.5 s on cold startup (Phase 1 / O1).
  const manager = getOpenClawEngineManager();
  const gatewayStatus = manager.getStatus();
  if (gatewayStatus.phase !== 'running') {
    const fastEnvVars = getOpenClawConfigSync().collectSecretEnvVars();
    manager.setSecretEnvVars(fastEnvVars);
    console.log(
      `${D()} ──── FAST PATH: gateway not running (phase=${gatewayStatus.phase}), env vars seeded (${Object.keys(fastEnvVars).length} keys). reason=${options.reason}`,
    );
    return {
      success: true,
      changed: syncResult.changed,
    };
  }

  const nextSecretEnvVars = getOpenClawConfigSync().collectSecretEnvVars();
  const prevSecretEnvVars = getOpenClawEngineManager().getSecretEnvVars();
  const secretEnvVarsChanged =
    JSON.stringify(nextSecretEnvVars) !== JSON.stringify(prevSecretEnvVars);
  getOpenClawEngineManager().setSecretEnvVars(nextSecretEnvVars);

  // Diagnostic: print which env vars changed
  if (secretEnvVarsChanged) {
    const allKeys = new Set([...Object.keys(prevSecretEnvVars), ...Object.keys(nextSecretEnvVars)]);
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    for (const k of allKeys) {
      const prev = prevSecretEnvVars[k];
      const next = nextSecretEnvVars[k];
      if (prev === next) continue;
      if (prev === undefined) {
        added.push(k);
      } else if (next === undefined) {
        removed.push(k);
      } else {
        modified.push(k);
      }
    }
    console.log(`${D()} SECRET ENV VARS CHANGED!`);
    if (added.length) console.log(`${D()}   added: ${added.join(', ')}`);
    if (removed.length) console.log(`${D()}   removed: ${removed.join(', ')}`);
    for (const k of modified) {
      const p = (prevSecretEnvVars[k] || '').slice(0, 12);
      const n = (nextSecretEnvVars[k] || '').slice(0, 12);
      console.log(`${D()}   modified: ${k} prev=${p}… next=${n}…`);
    }
  } else {
    console.log(`${D()} secretEnvVars unchanged (${Object.keys(nextSecretEnvVars).length} keys)`);
  }

  // Force a hard restart when the mcp-bridge callbackUrl or tools changed,
  // regardless of the restartGatewayIfRunning flag.  The OpenClaw gateway
  // pins its config snapshot at startup, so a hot-reload alone won't pick
  // up a new callbackUrl — the gateway must be fully restarted.
  //
  // bindingsChanged also requires a hard restart.  The top-level "bindings"
  // key in openclaw.json does not match any hot-reload prefix in the
  // gateway's BASE_RELOAD_RULES and falls through to the tail rule
  // (restartGateway=true).  On Windows, the gateway cannot restart itself
  // in-process (no SIGUSR1), so a full kill+spawn is the only reliable path.
  const mcpBridgeForceRestart = !!syncResult.mcpBridgeConfigChanged;
  const cronForceRestart = !!syncResult.cronConfigChanged;
  const channelsForceRestart = !!syncResult.channelsConfigChanged;
  const needsHardRestart =
    secretEnvVarsChanged ||
    syncResult.bindingsChanged ||
    mcpBridgeForceRestart ||
    cronForceRestart ||
    channelsForceRestart ||
    (syncResult.changed && options.restartGatewayIfRunning);

  console.log(
    `${D()} needsHardRestart=${needsHardRestart} (envChanged=${secretEnvVarsChanged} bindingsChanged=${!!syncResult.bindingsChanged} mcpBridgeChanged=${mcpBridgeForceRestart} cronChanged=${cronForceRestart} channelsChanged=${channelsForceRestart} configChanged=${syncResult.changed} restartFlag=${!!options.restartGatewayIfRunning})`,
  );

  if (!needsHardRestart) {
    console.log(`${D()} ──── NO RESTART, hot-reload only. reason=${options.reason}`);

    // NOTE: We intentionally do NOT push config via the config.apply RPC here.
    // The chokidar file watcher inside the gateway process picks up the new
    // openclaw.json within ~200ms and applies a targeted hot-reload for
    // skills/plugins/channels — the same outcome without the side effects.
    //
    // The config.apply RPC causes the gateway to resolve ${ENV_VAR}
    // placeholders (provider apiKeys, gateway auth token, plugin secrets)
    // into plaintext and write them back to openclaw.json.  Chokidar then
    // detects the write-back as a SECOND file change, compares the resolved
    // values against the in-memory config snapshot, and spuriously decides
    // that gateway.auth.token / plugin secrets have changed — triggering an
    // unnecessary 16-second hard restart for what should be a 200ms hot-reload
    // (e.g. toggling a skill on/off).

    return {
      success: true,
      changed: syncResult.changed,
      mcpBridgeConfigChanged: syncResult.mcpBridgeConfigChanged,
    };
  }

  if (
    hasActiveGatewayWorkloads() &&
    !syncResult.bindingsChanged &&
    !options.forceGatewayRestartIfRunning
  ) {
    console.log(`${D()} ──── RESTART DEFERRED (active workloads). reason=${options.reason}`);
    scheduleDeferredGatewayRestart(options.reason);
    return {
      success: true,
      changed: true,
      status: gatewayStatus,
    };
  }

  console.log(
    `${D()} ──── HARD RESTART EXECUTING. reason=${options.reason}, phase=${gatewayStatus.phase}, port=${gatewayStatus.message?.match(/loopback:(\d+)/)?.[1] ?? 'unknown'}`,
  );
  if (openClawChannelGateway) {
    openClawChannelGateway.disconnectGatewayClient();
  }

  const restarted = await manager.restartGateway(`config-sync:${options.reason}`);
  if (restarted.phase !== OpenClawEnginePhase.Running) {
    return {
      success: false,
      changed: true,
      status: restarted,
      error: restarted.message || 'Failed to restart OpenClaw gateway after config sync.',
    };
  }
  return {
    success: true,
    changed: true,
    status: restarted,
  };
};

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

const getOpenClawChannelGateway = (): OpenClawChannelGateway => {
  if (!openClawChannelGateway) {
    openClawChannelGateway = new OpenClawChannelGateway(
      getCoworkStore(),
      getOpenClawEngineManager(),
      {
        normalizeModelRef: normalizeOpenClawModelRef,
        isModelAvailableForSession: validateSessionModelAvailability,
        getModelContextWindow: modelRef => {
          const parsed = parsePrimaryModelRef(modelRef);
          if (!parsed || parsed.providerId !== ProviderName.LlamaCpp) return undefined;
          return getLlamaCppModelContextWindow(parsed.modelId);
        },
        getTriageConfig: () => getTriageConfig(getStore()),
        getAgent: (agentId: string) => {
          return getAgentManager().getAgent(agentId) ?? null;
        },
      },
    );
    // Wire up channel session sync for IM conversations via OpenClaw
    try {
      const imManager = getIMGatewayManager();
      const imStore = imManager.getIMStore();
      if (imStore) {
        const channelSessionSync = new OpenClawChannelSessionSync({
          coworkStore: getCoworkStore(),
          imStore,
          getDefaultCwd: () => getDefaultConversationWorkspacePath(),
          // IM channel conversations belong to the app's default conversation
          // workspace. Scheduled-task sessions use their own automation cwd.
          getChannelCwd: () => getDefaultConversationWorkspacePath(),
          getCronCwd: agentId => resolveAgentDefaultWorkingDirectory(agentId) || os.homedir(),
          resolveJobName: jobId => getCronJobService().getJobNameSync(jobId),
          onBindingChanged: (sessionKey, _platform, newAgentId) => {
            const agent = getCoworkStore().getAgent(newAgentId);
            const model = agent?.model || '';
            if (model && openClawChannelGateway) {
              const availability = validateSessionModelAvailability(model);
              if (!availability.available) return;
              const client = openClawChannelGateway.getGatewayClient();
              if (client) {
                void client.request('sessions.patch', { key: sessionKey, model }).catch(err => {
                  console.warn(
                    '[ChannelSessionSync] failed to patch Gateway session model after binding change:',
                    err,
                  );
                });
              }
            }
          },
        });
        openClawChannelGateway.setChannelSessionSync(channelSessionSync);
      }
    } catch (error) {
      console.warn('[Main] Failed to set up channel session sync:', error);
    }
  }
  return openClawChannelGateway;
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
const FEISHU_CLI_AUTH_TIMEOUT_MS = 600_000;
const FEISHU_MCP_REGISTRY_ID = 'feishu';

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
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      env: { ...process.env, ...(args[0]?.toLowerCase().endsWith('npm-cli.js') ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
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
    child.stdout.on('data', chunk => outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', chunk => outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
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

const prepareFeishuCli = async (): Promise<void> => {
  let cliCommand = await findFeishuCliCommand();
  if (!cliCommand) {
    const cliRoot = getFeishuCliRoot();
    fs.mkdirSync(cliRoot, { recursive: true });
    const bundledNpm = resolveBundledNpmRuntime(NpmCli.Npm, [
      'install',
      '--prefix',
      cliRoot,
      '--no-save',
      '@larksuite/cli',
    ]);
    if (!bundledNpm) throw new Error('Bundled npm runtime is unavailable. Please reinstall the application.');
    await runFeishuCliCommand(
      bundledNpm.command,
      bundledNpm.args,
      cliRoot,
    );
    cliCommand = await findFeishuCliCommand();
  }
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  const cliRoot = getFeishuCliRoot();

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
 * Safe to call from any context (Pi init, OpenClaw bootstrap, etc.) —
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
 * Start the MCP Bridge: server manager + HTTP callback.
 * Called during OpenClaw bootstrap before config sync.
 * Returns the bridge config to be written into openclaw.json.
 *
 * The HTTP callback server is always started (even without MCP servers)
 * because the AskUserQuestion plugin also uses it for user confirmation dialogs.
 */
const startMcpBridge = (): Promise<McpBridgeConfig | null> => {
  // Deduplicate concurrent calls — only one initialization at a time
  if (mcpBridgeStartPromise) {
    return mcpBridgeStartPromise;
  }
  mcpBridgeStartPromise = (async (): Promise<McpBridgeConfig | null> => {
    try {
      console.log('[McpBridge] startMcpBridge called');

      // initMcpServers may have already been called during app init.
      // It deduplicates internally — if MCP is already running, it returns
      // the cached toolManifest without restarting servers.
      const tools = await initMcpServers();

      // Always start HTTP callback server (serves both MCP Bridge and AskUserQuestion)
      if (!mcpServerManager) {
        mcpServerManager = new McpServerManager();
      }
      if (!mcpBridgeServer) {
        mcpBridgeServer = new McpBridgeServer(mcpServerManager, mcpBridgeSecret);
      }
      if (!mcpBridgeServer.port) {
        console.log('[McpBridge] starting HTTP callback server...');
        await mcpBridgeServer.start();
      }

      // Forward OpenClaw AskUser requests through their own renderer bridge.
      mcpBridgeServer.onAskUser(request => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          if (win.isDestroyed()) return;
          try {
            win.webContents.send(OpenClawBridgeIpc.AskUser, {
              sessionId: CoworkPermissionSessionId.OpenClawBridge,
              request: {
                requestId: request.requestId,
                toolName: CoworkPermissionToolName.AskUserQuestion,
                toolInput: { questions: request.questions },
              },
            });
          } catch (error) {
            console.error('[OpenClawBridge] failed to forward an AskUser request:', error);
          }
        });
      });

      mcpBridgeServer.onAskUserDismiss(requestId => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(win => {
          if (win.isDestroyed()) return;
          try {
            win.webContents.send(OpenClawBridgeIpc.AskUserDismiss, { requestId });
          } catch {
            // ignore
          }
        });
      });

      const callbackUrl = mcpBridgeServer.callbackUrl;
      const askUserCallbackUrl = mcpBridgeServer.askUserCallbackUrl;
      if (!callbackUrl || !askUserCallbackUrl) {
        console.error('[McpBridge] failed to get callback URL');
        return null;
      }

      console.log(`[McpBridge] started: ${tools.length} MCP tools, callback=${callbackUrl}`);
      return { callbackUrl, askUserCallbackUrl, secret: mcpBridgeSecret, tools };
    } catch (error) {
      console.error(
        '[McpBridge] startup error:',
        error instanceof Error ? error.stack || error.message : String(error),
      );
      return null;
    }
  })().finally(() => {
    mcpBridgeStartPromise = null;
  });
  return mcpBridgeStartPromise;
};

/**
 * Stop the MCP Bridge: server manager + HTTP callback.
 */
const _stopMcpBridge = async (): Promise<void> => {
  try {
    if (mcpServerManager) {
      await mcpServerManager.stopServers();
    }
    if (mcpBridgeServer) {
      await mcpBridgeServer.stop();
    }
  } catch (error) {
    console.error(
      '[McpBridge] shutdown error:',
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Refresh the MCP Bridge after server config changes:
 * stop existing MCP servers → restart with new config → sync openclaw.json → restart gateway.
 * Returns a summary for the renderer to display.
 */
let mcpBridgeRefreshPromise: Promise<{ tools: number; error?: string }> | null = null;

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
      // Reset the start promise so the dedup inside startMcpBridge does not
      // return a stale promise whose closure still captures the old enabled
      // server list (e.g. from a concurrent bootstrap or gateway-restart
      // cycle that calls startMcpBridge in the background).
      mcpBridgeStartPromise = null;

      // 2. Re-discover tools from the new set of enabled servers
      const bridgeConfig = await startMcpBridge();
      if (generation !== mcpLifecycleGeneration) {
        return { tools: 0, error: 'MCP configuration changed during refresh' };
      }
      const toolCount = bridgeConfig?.tools.length ?? 0;
      console.log(`[McpBridge] refresh: ${toolCount} tools discovered`);

      // 3. Sync openclaw.json before reporting completion. The gateway pins
      // its MCP tool snapshot at startup, so returning before this write lets
      // an uninstall appear complete while the Agent still has stale tools.
      const syncResult = await syncOpenClawConfig({ reason: 'mcp-server-changed' });
      if (!syncResult.success) {
        console.error('[McpBridge] config sync failed after refresh:', syncResult.error);
      }

      console.log(
        `[McpBridge] refresh complete: ${toolCount} tools discovered and Agent config synchronized`,
      );
      return { tools: toolCount, error: syncResult.success ? undefined : syncResult.error };
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
    });
  return mcpBridgeRefreshPromise;
};

const getIMGatewayManager = () => {
  if (!imGatewayManager) {
    const sqliteStore = getStore();

    // IM always uses OpenClaw directly, bypassing the engine router.
    // This ensures IM/Cron remain on OpenClaw regardless of the user's
    // Work/Chat engine selection (Pi / OpenClaw).
    if (!openClawChannelGateway) {
      throw new Error('[IMGateway] OpenClaw runtime adapter not initialized');
    }
    const runtime = openClawChannelGateway;
    const store = getCoworkStore();

    imGatewayManager = new IMGatewayManager(sqliteStore.getDatabase(), {
      coworkRuntime: runtime,
      coworkStore: store,
      ensureCoworkReady: async () => {
        const status = await ensureOpenClawRunningForCowork();
        if (status.phase !== 'running') {
          throw new Error(
            status.message || 'AI engine is initializing. Please try again in a moment.',
          );
        }
      },
      syncOpenClawConfig: async (reason?: string) => {
        await syncOpenClawConfig({
          reason: reason || 'im-gateway-sync',
        });
      },
      ensureOpenClawGatewayConnected: async () => {
        if (openClawChannelGateway) {
          await openClawChannelGateway.connectGatewayIfNeeded();
        }
      },
      getOpenClawGatewayClient: () => openClawChannelGateway?.getGatewayClient() ?? null,
      ensureOpenClawGatewayReady: async () => {
        if (!openClawChannelGateway) {
          throw new Error('OpenClaw runtime adapter not initialized.');
        }
        await openClawChannelGateway.ensureReady();
        await openClawChannelGateway.connectGatewayIfNeeded();
      },
      getOpenClawSessionKeysForCoworkSession: (sessionId: string) => {
        return openClawChannelGateway?.getSessionKeysForSession(sessionId) ?? [];
      },
      createScheduledTask: async ({ sessionId, message, request }) => {
        // if (message.platform === 'dingtalk') {
        //   await getIMGatewayManager().primeConversationReplyRoute(
        //     message.platform,
        //     message.conversationId,
        //     sessionId,
        //   );
        // }
        const channelName = PlatformRegistry.channelOf(message.platform);
        const hasChannel = !!(channelName && message.conversationId);
        // Strip IM subtype prefix (e.g. "direct:ou_xxx" -> "ou_xxx")
        let deliveryTo = message.conversationId;
        if (hasChannel && deliveryTo) {
          const colonIdx = deliveryTo.indexOf(':');
          if (colonIdx > 0) {
            deliveryTo = deliveryTo.slice(colonIdx + 1);
          }
        }
        const task = await getCronJobService().addJob({
          name: request.taskName,
          description: '',
          enabled: true,
          schedule: {
            kind: 'at',
            at: request.scheduleAt,
          },
          sessionTarget: hasChannel ? 'isolated' : 'main',
          wakeMode: 'now',
          payload: hasChannel
            ? { kind: 'agentTurn', message: request.payloadText }
            : { kind: 'systemEvent', text: request.payloadText },
          delivery: {
            mode: hasChannel ? 'announce' : 'none',
            ...(channelName ? { channel: channelName } : {}),
            ...(hasChannel
              ? { to: deliveryTo }
              : message.conversationId
                ? { to: message.conversationId }
                : {}),
          },
          agentId: DEFAULT_MANAGED_AGENT_ID,
          ...(hasChannel
            ? {}
            : { sessionKey: buildManagedSessionKey(sessionId, DEFAULT_MANAGED_AGENT_ID) }),
        });
        return {
          id: task.id,
          name: task.name,
          agentId: task.agentId,
          sessionKey: task.sessionKey,
          payloadText:
            task.payload.kind === 'systemEvent'
              ? task.payload.text
              : task.payload.kind === 'agentTurn'
                ? task.payload.message
                : '',
          scheduleAt: task.schedule.kind === 'at' ? task.schedule.at : request.scheduleAt,
        };
      },
    });

    // Initialize with LLM config provider
    imGatewayManager.initialize({
      getLLMConfig: async () => {
        type LlmProviderConfig = {
          enabled?: boolean;
          apiKey?: string;
          baseUrl?: string;
          models?: Array<{ id: string }>;
        };
        type LlmAppConfig = {
          providers?: Record<string, LlmProviderConfig>;
          api?: { key?: string; baseUrl?: string };
          model?: { defaultModel?: string };
        };
        const appConfig = sqliteStore.get<LlmAppConfig>('app_config');
        if (!appConfig) return null;

        // Find first enabled provider
        const providers = appConfig.providers || {};
        for (const [providerName, providerConfig] of Object.entries(providers)) {
          if (providerConfig.enabled && providerConfig.apiKey) {
            const model = providerConfig.models?.[0]?.id;
            return {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              model: model,
              provider: providerName,
            };
          }
        }

        // Fallback to legacy api config
        if (appConfig.api?.key) {
          return {
            apiKey: appConfig.api.key,
            baseUrl: appConfig.api.baseUrl,
            model: appConfig.model?.defaultModel,
          };
        }

        return null;
      },
      getSkillsPrompt: async () => {
        return getSkillManager().buildAutoRoutingPrompt();
      },
    });

    // Forward IM events to renderer
    imGatewayManager.on('statusChange', status => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:status:change', status);
        }
      });
    });

    imGatewayManager.on('message', message => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:message:received', message);
        }
      });
    });

    imGatewayManager.on('error', ({ platform, error }) => {
      console.error(`[IM Gateway] ${platform} error:`, error);
    });

    // Wire gateway lifecycle notifications
    if (openClawChannelGateway) {
      openClawChannelGateway.onGatewayDisconnect(reason => {
        imGatewayManager?.onOpenClawDisconnected(reason);
      });
      openClawChannelGateway.onGatewayReconnect(() => {
        imGatewayManager?.onOpenClawReconnected();
      });
    }
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
  const normalizedIds = [...new Set(requestedExpertIds.map(id => id.trim()).filter(Boolean))];
  return (
    experts.length === normalizedIds.length &&
    experts.every((expert, index) => expert.expertId === normalizedIds[index])
  );
};

const resolveSessionExpertSnapshots = (expertIds: string[]): CoworkSessionExpertInput[] => {
  const snapshots: CoworkSessionExpertInput[] = [];
  const seen = new Set<string>();
  for (const rawExpertId of expertIds) {
    const expertId = rawExpertId.trim();
    if (!expertId || seen.has(expertId)) continue;
    seen.add(expertId);

    const expert = getAgentManager().getAgent(expertId);
    if (
      !expert ||
      (expert.source !== CoworkSessionExpertSource.Package &&
        expert.source !== CoworkSessionExpertSource.Member)
    ) {
      throw new Error(`Expert '${expertId}' is not installed or is not an expert package agent`);
    }
    const promptSnapshot = expert.systemPrompt.trim();
    if (!promptSnapshot) {
      throw new Error(`Expert '${expertId}' has an empty system prompt`);
    }
    const packageId = expert.presetId.trim() || expert.id;
    const skillIds = [...expert.skillIds];
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

if (!gotTheLock) {
  app.quit();
} else {
  // Register custom protocol for OAuth callback
  app.setAsDefaultProtocolClient('zhiyuan');

  const COMMUNITY_AUTH_ORIGIN = 'https://account.rongxzyai.com';
  const COMMUNITY_AUTH_SESSION_KEY = 'community_auth_session_v1';
  let pendingCommunityLogin: { state: string; verifier: string; expiresAt: number } | null = null;

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
      const syncResult = await syncOpenClawConfig({
        reason: 'app-config-change',
        restartGatewayIfRunning: false,
      });
      if (!syncResult.success) {
        console.error(
          '[OpenClaw] Failed to sync config after app_config update:',
          syncResult.error,
        );
      }
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

  ipcMain.handle('hardware:nvidia-smi', async () => getNvidiaSmiSnapshot());
  ipcMain.handle(HardwareIpc.SystemMemory, async () => getSystemMemorySnapshot());

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);

    if (status === 'online' && imGatewayManager) {
      console.log('[Main] Network restored, reconnecting IM gateways...');
      imGatewayManager.reconnectAllDisconnected();
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
      const manager = getOpenClawEngineManager();
      const archiveResult = await exportLogsZip({
        outputPath,
        entries: [
          ...getRecentMainLogEntries(),
          { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
          ...manager.getRecentGatewayLogEntries(),
          ...getRecentOpenClawDailyLogEntries(manager.getOpenClawDailyLogDir()),
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
      throw new Error('System secure storage is unavailable; the login session cannot be saved safely.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    getStore().set(COMMUNITY_AUTH_SESSION_KEY, { version: 1, encrypted });
  };

  const getCommunitySession = (): CommunityAuthSession | null => {
    const stored = getStore().get<{ version?: unknown; encrypted?: unknown }>(COMMUNITY_AUTH_SESSION_KEY);
    if (stored?.version !== 1 || typeof stored.encrypted !== 'string' || !canPersistCommunitySession()) return null;
    try {
      const decoded = JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))) as CommunityAuthSession;
      if (!decoded.accessToken || !decoded.refreshToken || !decoded.user?.id || !decoded.user?.email) throw new Error('invalid session');
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
      const payload = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        user?: { id?: string; email?: string };
      };
      if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.user?.id || !payload.user.email) {
        throw new Error('Token exchange failed');
      }
      saveCommunitySession({
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        user: { id: payload.user.id, email: payload.user.email },
      });
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: true,
        user: { id: payload.user.id, email: payload.user.email, name: payload.user.email },
      });
      if (mainWindow?.isMinimized()) mainWindow.restore();
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
      mainWindow?.focus();
    } catch (error) {
      console.warn('[CommunityAuth] login callback failed:', error instanceof Error ? error.message : error);
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: false,
        error: '登录未完成，请重试。',
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
      const payload = (await response.json()) as { login_url?: string; error?: string };
      if (!response.ok || !payload.login_url || !payload.login_url.startsWith(`${COMMUNITY_AUTH_ORIGIN}/`)) {
        return { success: false, error: payload.error || '无法开始登录，请稍后重试。' };
      }
      pendingCommunityLogin = { state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 };
      await shell.openExternal(payload.login_url);
      return { success: true };
    } catch (error) {
      console.error('[Auth] login failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open login',
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

  ipcMain.handle('openclaw:engine:getStatus', async () => {
    try {
      const manager = getOpenClawEngineManager();
      return {
        success: true,
        status: manager.getStatus(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw engine status',
      };
    }
  });

  ipcMain.handle('openclaw:engine:install', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: false,
        reason: 'manual-install',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to install OpenClaw engine',
      };
    }
  });

  ipcMain.handle('openclaw:engine:retryInstall', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: true,
        reason: 'manual-retry',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to retry OpenClaw engine install',
      };
    }
  });

  let restartGatewayPromise: Promise<OpenClawEngineStatus> | null = null;
  ipcMain.handle('openclaw:engine:restartGateway', async () => {
    console.log(
      `${gwDiagTs()} IPC openclaw:engine:restartGateway: manual restart requested from renderer`,
    );
    if (restartGatewayPromise) {
      console.log(
        `${gwDiagTs()} IPC openclaw:engine:restartGateway: restart already in progress, joining existing promise`,
      );
      const status = await restartGatewayPromise;
      return { success: status.phase === 'running' || status.phase === 'ready', status };
    }
    try {
      const manager = getOpenClawEngineManager();
      restartGatewayPromise = manager.restartGateway('ipc-manual');
      const status = await restartGatewayPromise;
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to restart OpenClaw gateway',
      };
    } finally {
      restartGatewayPromise = null;
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
          const probeResult = await probeMcpConnection(existing);
          if (!probeResult.success) {
            return { success: false, error: probeResult.error || 'Failed to test MCP connection' };
          }
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
        // for OpenClaw — that gate is only for IM/Cron paths.
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
            autoApprove: options.permissionMode === CoworkPermissionMode.AllowAll,
            imageAttachments: options.imageAttachments,
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
                  error: errorMessage,
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

  ipcMain.handle(
    CoworkSessionIpc.Continue,
    async (
      _event,
      options: {
        sessionId: string;
        prompt: string;
        systemPrompt?: string;
        activeSkillIds?: string[];
        goalMode?: boolean;
        expertIds?: string[];
        permissionMode?: CoworkPermissionMode;
        imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
      },
    ) => {
      try {
        // Work sessions use Pi (SDK mode, instant availability).
        const runtime = getPiRuntimeAdapter();
        const store = getCoworkStore();
        let existingSession = store.getSession(options.sessionId);
        if (existingSession) {
          const previousExpertSnapshots = existingSession.experts;
          const expertSnapshots =
            options.expertIds === undefined ||
            haveSameExpertIds(previousExpertSnapshots, options.expertIds)
              ? previousExpertSnapshots
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
            imageAttachments: options.imageAttachments,
            workspaceRoot: existingSession?.cwd,
            agentId: existingSession?.agentId,
            expertIds: existingSession?.experts.map(expert => expert.expertId),
            modelOverride: existingSession?.modelOverride,
            autoApprove: options.permissionMode === CoworkPermissionMode.AllowAll,
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
                  error: errorMessage,
                });
              });
            } catch (handlerError) {
              console.error(
                '[Cowork] failed to send error notification to renderer:',
                handlerError,
              );
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
    },
  );

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
      return getPiRuntimeAdapter().enqueuePendingMessage(input.sessionId, input.text);
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

  ipcMain.handle('cowork:session:gatewaySessionId', async (_event, zhiyuanSessionId: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const sessionsPath = path.join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
      const raw = await fs.promises.readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(raw);
      const sessionKey = `agent:main:zhiyuan:${zhiyuanSessionId}`;
      const entry = sessions[sessionKey];
      return { success: true, gatewaySessionId: entry?.sessionId ?? null };
    } catch {
      return { success: false, gatewaySessionId: null };
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
      },
    ) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const workspaceId = options?.workspaceId;
        const mode = options?.mode;
        const store = getCoworkStore();
        const sessions = store
          .listSessions(limit, offset, agentId, workspaceId, mode)
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
        const total = store.countSessions(agentId, workspaceId, mode);
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
        // Sync config so workspace files (SOUL.md, IDENTITY.md, USER.md) are written
        // before OpenClaw scaffolds default templates for the new agent.
        syncOpenClawConfig({ reason: 'agent-created' }).catch(err => {
          console.error('[OpenClaw] config sync after agent-created failed:', err);
        });
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
        const shouldSyncOpenClawConfig = Object.keys(updates).some(key => key !== 'pinned');
        if (shouldSyncOpenClawConfig) {
          syncOpenClawConfig({ reason: 'agent-updated' }).catch(err => {
            console.error('[OpenClaw] config sync after agent-updated failed:', err);
          });
        }
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

      // Clean up IM platform bindings that reference the deleted agent
      // so that channels fall back to the default 'main' agent.
      try {
        const imStore = getIMGatewayManager()?.getIMStore();
        if (imStore) {
          const imSettings = imStore.getIMSettings();
          const bindings = imSettings.platformAgentBindings;
          if (bindings) {
            let changed = false;
            for (const [platform, agentId] of Object.entries(bindings)) {
              if (agentId === id) {
                delete bindings[platform];
                changed = true;
              }
            }
            if (changed) {
              imStore.setIMSettings({ platformAgentBindings: bindings });
            }
          }
        }
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }

      syncOpenClawConfig({ reason: 'agent-deleted' }).catch(err => {
        console.error('[OpenClaw] config sync after agent-deleted failed:', err);
      });
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
      const { parseExpertPackage } = require(
        path.join(bundledSkillsRoot, 'zhiyuan-expert-manager', 'scripts', 'register_expert'),
      );
      const dbPath = path.join(app.getPath('userData'), DB_FILENAME);
      const { pluginJson, requests, piSyncedFiles } = parseExpertPackage(expertDir, { dbPath });

      const agentManager = getAgentManager();
      const defaultModel = resolveDefaultAgentModelRef();
      const agentIds: string[] = [];

      for (const request of requests) {
        const agent = agentManager.createAgent(request, defaultModel);
        agentIds.push(agent.id);
      }

      // Write to expert-packages/registry.json in userData
      const packagesDir = path.join(app.getPath('userData'), 'expert-packages');
      fs.mkdirSync(packagesDir, { recursive: true });
      const registryPath = path.join(packagesDir, 'registry.json');
      let registry: { packages: Array<Record<string, unknown>> } = { packages: [] };
      if (fs.existsSync(registryPath)) {
        try {
          registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
          if (!Array.isArray(registry.packages)) registry.packages = [];
        } catch {
          registry = { packages: [] };
        }
      }
      registry.packages = registry.packages.filter(p => p.name !== pluginJson.name);
      registry.packages.push({
        name: pluginJson.name,
        version: pluginJson.version,
        expertType: pluginJson.expertType,
        path: expertDir,
        agentIds,
        piSyncedFiles: piSyncedFiles || [],
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');

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
      const presetsDir = path.join(bundledSkillsRoot, 'zhiyuan-expert-manager', 'presets');
      if (!fs.existsSync(presetsDir)) return { experts: [] };

      const entries = fs.readdirSync(presetsDir, { withFileTypes: true });
      const experts = entries
        .filter(e => e.isDirectory())
        .map(e => {
          const pluginPath = path.join(presetsDir, e.name, 'plugin.json');
          if (!fs.existsSync(pluginPath)) return null;
          try {
            const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
            return {
              name: plugin.name,
              displayName: plugin.displayName,
              profession: plugin.profession,
              displayDescription: plugin.displayDescription,
              categoryId: plugin.categoryId,
              tags: plugin.tags,
              quickPrompts: plugin.quickPrompts,
              path: path.join(presetsDir, e.name),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return { experts };
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

  registerOpenClawBridgeIpcHandlers({
    getMcpBridgeServer: () => mcpBridgeServer,
  });

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

  ipcMain.handle(OpenClawSessionPolicyIpc.Get, async () => {
    try {
      const config = loadOpenClawSessionPolicyConfig(getStore());
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionPolicyIpc.Set, async (_event, config: unknown) => {
    try {
      const saved = saveOpenClawSessionPolicyConfig(getStore(), config);
      // Persist first and let the caller decide when to perform a unified sync/restart.
      await syncOpenClawConfig({
        reason: 'session-policy-updated',
        restartGatewayIfRunning: false,
      });
      return { success: true, config: saved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionIpc.Patch, async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid OpenClaw session patch input.');
      }

      const request = input as { sessionId?: unknown; patch?: unknown };
      const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : '';
      if (!sessionId) {
        throw new Error('Session ID is required.');
      }

      const patch = sanitizeOpenClawSessionPatch(request.patch);
      if (patch.model) {
        patch.model = normalizeOpenClawModelRef(patch.model);
      }
      const runtime = getPiRuntimeAdapter();
      await runtime.patchSession(sessionId, patch);

      if (patch.model !== undefined) {
        getCoworkStore().updateSession(
          sessionId,
          {
            modelOverride: patch.model ?? '',
          },
          { touchUpdatedAt: false },
        );
      }

      const session = getCoworkStore().getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      return {
        success: true,
        session,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to patch OpenClaw session',
      };
    }
  });

  ipcMain.handle(
    'cowork:memory:listEntries',
    async (
      _event,
      input: {
        query?: string;
        status?: 'created' | 'stale' | 'deleted' | 'all';
        includeDeleted?: boolean;
        limit?: number;
        offset?: number;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );

        // Lazy migration: SQLite → MEMORY.md (one-time, cached in memory)
        if (!memoryMigrationDone) {
          migrateSqliteToMemoryMd(filePath, {
            isMigrationDone: () =>
              getStore().get<string>('openclawMemory.migration.v1.completed') === '1',
            markMigrationDone: () => {
              getStore().set('openclawMemory.migration.v1.completed', '1');
              memoryMigrationDone = true;
            },
            getActiveMemoryTexts: () => {
              return getCoworkStore()
                .listUserMemories({ status: 'all', includeDeleted: false, limit: 200 })
                .map(m => m.text);
            },
          });
          // Even if migration found nothing, skip future checks this session
          memoryMigrationDone = true;
        }

        const query = input?.query?.trim() || '';
        const entries = query ? searchMemoryEntries(filePath, query) : readMemoryEntries(filePath);
        return { success: true, entries };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list memory entries',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:createEntry',
    async (
      _event,
      input: {
        text: string;
        confidence?: number;
        isExplicit?: boolean;
        source?: MemorySource;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        const source =
          input.source && typeof input.source === 'object'
            ? ({
                sessionId:
                  typeof input.source.sessionId === 'string' ? input.source.sessionId : null,
                role: (['user', 'assistant', 'tool', 'system', 'im'] as const).includes(
                  input.source.role as MemorySource['role'],
                )
                  ? input.source.role
                  : 'system',
                date:
                  typeof input.source.date === 'string'
                    ? input.source.date
                    : new Date().toISOString().slice(0, 10),
              } as MemorySource)
            : undefined;
        const entry = addMemoryEntry(filePath, input.text, source);
        return { success: true, entry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create memory entry',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:updateEntry',
    async (
      _event,
      input: {
        id: string;
        text?: string;
        confidence?: number;
        status?: 'created' | 'stale' | 'deleted';
        isExplicit?: boolean;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        if (!input.text) {
          return { success: false, error: 'Memory text is required' };
        }
        const entry = updateMemoryEntry(filePath, input.id, input.text);
        if (!entry) {
          return { success: false, error: 'Memory entry not found' };
        }
        return { success: true, entry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update memory entry',
        };
      }
    },
  );
  ipcMain.handle(
    'cowork:memory:deleteEntry',
    async (
      _event,
      input: {
        id: string;
      },
    ) => {
      try {
        const filePath = resolveMemoryFilePath(
          getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
        );
        const success = deleteMemoryEntry(filePath, input.id);
        return success ? { success: true } : { success: false, error: 'Memory entry not found' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete memory entry',
        };
      }
    },
  );
  ipcMain.handle('cowork:memory:getStats', async () => {
    try {
      const filePath = resolveMemoryFilePath(
        getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()),
      );
      const entries = readMemoryEntries(filePath);
      return {
        success: true,
        stats: {
          total: entries.length,
          created: entries.length,
          stale: 0,
          deleted: 0,
          explicit: entries.length,
          implicit: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memory stats',
      };
    }
  });
  ipcMain.handle('cowork:bootstrap:read', async (_event, filename: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
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
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
      writeBootstrapFile(mainWorkspace, filename, content);
      syncOpenClawConfig({ reason: 'bootstrap-updated' }).catch(err => {
        console.error('[OpenClaw] config sync after bootstrap-updated failed:', err);
      });
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
        agentEngine?: 'openclaw' | 'pi';
        memoryEnabled?: boolean;
        memoryImplicitUpdateEnabled?: boolean;
        memoryLlmJudgeEnabled?: boolean;
        memoryGuardLevel?: 'strict' | 'standard' | 'relaxed';
        memoryUserMemoriesMaxItems?: number;
        skipMissedJobs?: boolean;
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
        const normalizedAgentEngine =
          config.agentEngine === 'openclaw' || config.agentEngine === 'pi'
            ? config.agentEngine
            : undefined;
        const normalizedMemoryEnabled =
          typeof config.memoryEnabled === 'boolean' ? config.memoryEnabled : undefined;
        const normalizedMemoryImplicitUpdateEnabled =
          typeof config.memoryImplicitUpdateEnabled === 'boolean'
            ? config.memoryImplicitUpdateEnabled
            : undefined;
        const normalizedMemoryLlmJudgeEnabled =
          typeof config.memoryLlmJudgeEnabled === 'boolean'
            ? config.memoryLlmJudgeEnabled
            : undefined;
        const normalizedMemoryGuardLevel =
          config.memoryGuardLevel === 'strict' ||
          config.memoryGuardLevel === 'standard' ||
          config.memoryGuardLevel === 'relaxed'
            ? config.memoryGuardLevel
            : undefined;
        const normalizedMemoryUserMemoriesMaxItems =
          typeof config.memoryUserMemoriesMaxItems === 'number' &&
          Number.isFinite(config.memoryUserMemoriesMaxItems)
            ? Math.max(
                MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
                Math.min(
                  MAX_MEMORY_USER_MEMORIES_MAX_ITEMS,
                  Math.floor(config.memoryUserMemoriesMaxItems),
                ),
              )
            : undefined;
        const normalizedSkipMissedJobs =
          typeof config.skipMissedJobs === 'boolean' ? config.skipMissedJobs : undefined;
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
          agentEngine: normalizedAgentEngine,
          memoryEnabled: normalizedMemoryEnabled,
          memoryImplicitUpdateEnabled: normalizedMemoryImplicitUpdateEnabled,
          memoryLlmJudgeEnabled: normalizedMemoryLlmJudgeEnabled,
          memoryGuardLevel: normalizedMemoryGuardLevel,
          memoryUserMemoriesMaxItems: normalizedMemoryUserMemoriesMaxItems,
          skipMissedJobs: normalizedSkipMissedJobs,
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
            getPiRuntimeAdapter().setAutoApproveForSession(
              sessionId,
              mode === CoworkPermissionMode.AllowAll,
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

        const nextConfig = getCoworkStore().getConfig();

        // Any non-undefined normalized field means the user changed a config value
        // that affects the generated openclaw.json. Only model config changes
        // trigger secret-env-var changes (and thus a hard restart automatically),
        // so pass restartGatewayIfRunning=true for all cowork config changes.
        const shouldSyncOpenClawConfig =
          normalizedExecutionMode !== undefined ||
          normalizedAgentEngine !== undefined ||
          normalizedSkipMissedJobs !== undefined ||
          normalizedConfig.workingDirectory !== undefined ||
          Object.values(normalizedEmbedding).some(v => v !== undefined);
        if (shouldSyncOpenClawConfig) {
          const syncResult = await syncOpenClawConfig({
            reason: 'cowork-config-change',
            restartGatewayIfRunning: true,
          });
          if (!syncResult.success && nextConfig.agentEngine === 'openclaw') {
            return {
              success: false,
              code: ENGINE_NOT_READY_CODE,
              error: syncResult.error || 'OpenClaw config sync failed.',
              engineStatus: syncResult.status || getOpenClawEngineManager().getStatus(),
            };
          }
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
        listSessionMappings: (platform: string, agentId?: string) =>
          getIMGatewayManager()
            .getIMStore()
            .listSessionMappings(platform as Platform, agentId)
            .map(mapping => ({
              ...mapping,
              lastActiveAt: String(mapping.lastActiveAt),
            })),
      }),
      primeConversationReplyRoute: (
        platform: string,
        conversationId: string,
        coworkSessionId: string,
      ) =>
        getIMGatewayManager().primeConversationReplyRoute(
          platform as Platform,
          conversationId,
          coworkSessionId,
        ),
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

  // Debounce + serialization for im:config:set → syncOpenClawConfig.
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
      console.log(
        '[IM] doImConfigSync: calling syncOpenClawConfig with restartGatewayIfRunning=true',
      );
      await syncOpenClawConfig({
        reason: 'im-config-change',
        restartGatewayIfRunning: true,
      });
      // After config sync, ensure the runtime adapter's WebSocket client
      // is connected so channel events are received.
      if (openClawChannelGateway) {
        try {
          await openClawChannelGateway.connectGatewayIfNeeded();
        } catch (connectError) {
          console.error('[IM] Failed to connect gateway client after config sync:', connectError);
        }
      }
    } catch (error) {
      console.error('[IM] Debounced config sync failed:', error);
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

  ipcMain.handle(
    'im:config:set',
    async (_event, config: Partial<IMGatewayConfig>, options?: { syncGateway?: boolean }) => {
      try {
        getIMGatewayManager().setConfig(config, { syncGateway: options?.syncGateway });

        // Sync OpenClaw config once for all platform changes (instead of per-platform).
        // setConfig() already persists to DB synchronously, so syncOpenClawConfig just
        // needs to regenerate openclaw.json and restart the gateway once.
        // Only trigger sync when explicitly requested via syncGateway flag (e.g. from
        // the global Save button), to avoid frequent gateway restarts on every field blur.
        const hasOpenClawChange =
          config.telegram ||
          config.discord ||
          config.dingtalk ||
          config.feishu ||
          config.qq ||
          config.wecom ||
          config.weixin;
        if (
          options?.syncGateway &&
          hasOpenClawChange &&
          getOpenClawEngineManager().getStatus().phase === 'running'
        ) {
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

  // Explicitly trigger OpenClaw config sync + gateway restart.
  // Called from the global Settings Save button after config fields have been
  // persisted to DB via im:config:set (without syncGateway flag).
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

  ipcMain.handle(
    'im:gateway:test',
    async (_event, platform: Platform, configOverride?: Partial<IMGatewayConfig>) => {
      try {
        const result = await getIMGatewayManager().testGateway(platform, configOverride);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
        };
      }
    },
  );

  // Weixin QR login
  ipcMain.handle('im:weixin:qr-login-start', async () => {
    try {
      const result = await getIMGatewayManager().weixinQrLoginStart();
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start Weixin QR login',
      };
    }
  });

  ipcMain.handle('im:weixin:qr-login-wait', async (_event, accountId?: string) => {
    try {
      const result = await getIMGatewayManager().weixinQrLoginWait(accountId);
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : 'Weixin QR login failed',
      };
    }
  });

  ipcMain.handle('im:status:get', async () => {
    try {
      const status = getIMGatewayManager().getStatus();
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
  ipcMain.handle('im:openclaw:config-schema', async () => {
    try {
      const result = await getIMGatewayManager().getOpenClawConfigSchema();
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw config schema',
      };
    }
  });

  // ---- Pairing IPC handlers ----

  ipcMain.handle('im:pairing:list', async (_event, platform: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const requests = listPairingRequests(platform, stateDir);
      const allowFrom = readAllowFromStore(platform, stateDir);
      return { success: true, requests, allowFrom };
    } catch (error) {
      return {
        success: false,
        requests: [],
        allowFrom: [],
        error: error instanceof Error ? error.message : 'Failed to list pairing requests',
      };
    }
  });

  ipcMain.handle('im:pairing:approve', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const approved = approvePairingCode(platform, code, stateDir);
      if (!approved) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      await syncOpenClawConfig({
        reason: `im-pairing-approval:${platform}`,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to approve pairing code',
      };
    }
  });

  ipcMain.handle('im:pairing:reject', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const rejected = rejectPairingRequest(platform, code, stateDir);
      if (!rejected) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reject pairing request',
      };
    }
  });

  // DingTalk Multi-Instance handlers
  ipcMain.handle('im:dingtalk:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DINGTALK_OPENCLAW_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'DingTalk Bot',
      };
      getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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
  ipcMain.handle('im:qq:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_QQ_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'QQ Bot',
      };
      getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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
  ipcMain.handle('im:feishu:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_FEISHU_OPENCLAW_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Feishu Bot',
      };
      getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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
  ipcMain.handle('im:wecom:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_WECOM_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'WeCom Bot',
      };
      getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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
  ipcMain.handle('im:telegram:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_TELEGRAM_OPENCLAW_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Telegram Bot',
      };
      getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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
  ipcMain.handle('im:discord:instance:add', async (_event, name: string) => {
    try {
      const instanceId = crypto.randomUUID();
      const { DEFAULT_DISCORD_OPENCLAW_CONFIG: defaults } = await import('./im/types.js');
      const instance = {
        ...defaults,
        instanceId,
        instanceName: name || 'Discord Bot',
      };
      getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
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
      if (getOpenClawEngineManager().getStatus().phase === 'running') {
        scheduleImConfigSync();
      }
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
        if (options?.syncGateway && getOpenClawEngineManager().getStatus().phase === 'running') {
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

  // Feishu bot install helpers
  ipcMain.handle('feishu:install:qrcode', async (_event, { isLark }: { isLark: boolean }) => {
    try {
      return await getIMGatewayManager().startFeishuInstallQrcode(isLark);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle('feishu:install:poll', async (_event, { deviceCode }: { deviceCode: string }) => {
    try {
      return await getIMGatewayManager().pollFeishuInstall(deviceCode);
    } catch (error) {
      return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
    }
  });

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
  // writes <CODEX_HOME>/auth.json so the OpenClaw runtime can pick it up.
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

      const devPort = process.env.ELECTRON_START_URL?.match(/:(\d+)/)?.[1] || '5175';
      const cspDirectives = [
        "default-src 'self'",
        isDev
          ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:${devPort} ws://localhost:${devPort}`
          : "script-src 'self' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http: localfile:",
        // 允许连接到所有域名，不做限制
        'connect-src *',
        "font-src 'self' data:",
        "media-src 'self'",
        "worker-src 'self' blob:",
        "frame-src 'self' file:",
      ];

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': cspDirectives.join('; '),
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
      if (openClawEngineManager && !mainWindow?.isDestroyed()) {
        mainWindow.webContents.send(
          'openclaw:engine:onProgress',
          openClawEngineManager.getStatus(),
        );
      }
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

    // 处理渲染进程崩溃或退出
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('Window render process gone:', details);
      scheduleReload('webContents-crashed');
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
          console.warn(
            '[Main] Canonical scheduler not available yet:',
            err,
          );
        }

        // One-time migration: import legacy SQLite task records into the
        // canonical scheduler. No task is sent to OpenClaw.
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

  const runAppCleanup = async (): Promise<void> => {
    console.log('[Main] App is quitting, starting cleanup...');
    destroyTray();
    skillManager?.stopWatching();

    // Stop all active sessions from both kernels without blocking shutdown.
    console.log('[Main] Stopping cowork sessions...');
    if (piRuntimeAdapter) piRuntimeAdapter.stopAllSessions();
    if (openClawChannelGateway) openClawChannelGateway.stopAllSessions();

    await stopCoworkOpenAICompatProxy().catch(error => {
      console.error('Failed to stop OpenAI compatibility proxy:', error);
    });

    // Stop skill services.
    const skillServices = getSkillServiceManager();
    await skillServices.stopAll();

    // Stop all IM gateways gracefully.
    if (imGatewayManager) {
      await imGatewayManager.stopAll().catch(err => {
        console.error('[IM Gateway] Error stopping gateways on quit:', err);
      });
    }
    await ccConnectBridgeServer?.stop().catch(error => {
      console.error('[cc-connect] Failed to stop bridge on quit:', error);
    });
    ccConnectBridgeServer = null;
    if (schedulerClockRestartTimer) clearTimeout(schedulerClockRestartTimer);
    schedulerClockRestartTimer = null;
    await ccConnectSidecarManager?.stop();
    ccConnectSidecarManager = null;
    ccConnectChannelSidecarsStopping = true;
    for (const timer of ccConnectChannelRestartTimers.values()) clearTimeout(timer);
    ccConnectChannelRestartTimers.clear();
    await Promise.all(Array.from(ccConnectChannelSidecarManagers.values(), manager => manager.stop()));
    ccConnectChannelSidecarManagers.clear();

    if (openClawEngineManager) {
      await openClawEngineManager.stopGateway().catch(error => {
        console.error('[OpenClaw] Failed to stop gateway on quit:', error);
      });
    }

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

    // Stop the cron job polling
    try {
      getCronJobService().stopPolling();
    } catch {
      // The canonical scheduler may not have been initialized — safe to ignore.
    }

    sqliteBackupManager?.stopPeriodicBackupLoop();

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

  const handleTerminationSignal = (signal: NodeJS.Signals) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    console.log(`[Main] Received ${signal}, running cleanup before exit...`);
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

  process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

  // 初始化应用
  const initApp = async () => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');

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
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    refreshEndpointsTestMode(store);
    sqliteBackupManager = new SqliteBackupManager(app.getPath('userData'));
    await startCcConnectBridge().catch(error =>
      console.error('[cc-connect] Failed to start local bridge:', error),
    );
    await startCanonicalSchedulerClock().catch(error =>
      console.error('[Scheduler] Failed to start canonical cc-connect clock:', error),
    );
    await startCcConnectChannelSidecars().catch(error =>
      console.error('[cc-connect] Failed to start channel sidecars:', error),
    );

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
    const recoveredScheduledRuns = new SqliteScheduledTaskStore(getStore().getDatabase()).recoverInterruptedRuns();
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
      startPreparedRun: async (task: WorkbenchTask, run: WorkbenchRun) => {
        const session = getCoworkStore().getSession(task.sessionId);
        if (!session) throw new Error('Cowork session not found.');
        const config = getCoworkStore().getConfig();
        await getPiRuntimeAdapter().continueSession(
          session.id,
          'Continue the current task from its persisted state and verify the result.',
          {
            systemPrompt: session.systemPrompt,
            skillIds: session.activeSkillIds,
            sessionMode: session.mode,
            workspaceRoot: session.cwd,
            agentId: session.agentId,
            expertIds: session.experts.map(expert => expert.expertId),
            modelOverride: session.modelOverride,
            autoApprove: config.permissionMode === CoworkPermissionMode.AllowAll,
            _workbenchRunId: run.id,
            _skipUserMessage: true,
          },
        );
      },
    });
    registerMemoryIpcHandlers({ getService: getProjectMemoryService });
    // Inject store getter into claudeSettings
    setStoreGetter(() => store);
    registerLlamaCppIpcHandlers(getLlamaCppManager(), {
      getStore,
      syncOpenClawConfig,
    });
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

    // Enterprise config sync — must run before openclawConfigSync
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        const imStoreInstance = getIMGatewayManager().getIMStore();
        const mcpStoreInstance = getMcpStore();
        syncEnterpriseConfig(
          enterpriseConfigPath,
          store,
          imStoreInstance,
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
          config => {
            const cs = getCoworkStore();
            cs.setConfig(config);
          },
          () => {
            const cs = getCoworkStore();
            return cs.getConfig().workingDirectory;
          },
          agent => {
            const cs = getCoworkStore();
            const existing = cs.getAgent(agent.id);
            const updates = {
              name: agent.name,
              description: agent.description,
              systemPrompt: agent.systemPrompt,
              identity: agent.identity,
              model: agent.model,
              icon: agent.icon,
              skillIds: agent.skillIds,
              enabled: agent.enabled,
            };
            if (existing) {
              cs.updateAgent(agent.id, updates);
            } else {
              cs.createAgent({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                systemPrompt: agent.systemPrompt,
                identity: agent.identity,
                model: agent.model,
                icon: agent.icon,
                skillIds: agent.skillIds,
                source: 'custom',
              });
              cs.updateAgent(agent.id, { enabled: agent.enabled });
            }
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
    // Previously this was deferred to ensureOpenClawRunningForCowork (OpenClaw
    // path), leaving Pi sessions without MCP tools until the async bootstrap
    // completed — or indefinitely if OpenClaw was never started.
    // initMcpServers is concurrency-safe: it deduplicates via a promise lock
    // and skips startServers() if the McpServerManager is already running.
    const mcpTools = await initMcpServers();
    console.log(`[Main] initApp: MCP init done, ${mcpTools.length} tools available`);

    bindPiWorkbenchRuntimeForwarder();
    // Channel/Cron own this runtime directly; it is intentionally not renderer-forwarded.
    getOpenClawChannelGateway();
    bindOpenClawStatusForwarder();

    const defaultAgentModelRef = resolveDefaultAgentModelRef();
    const backfilledAgentModels = getCoworkStore().backfillEmptyAgentModels(defaultAgentModelRef);
    const qualifiedAgentModels = migrateAgentModelRefs();
    if (backfilledAgentModels > 0 || qualifiedAgentModels > 0) {
      console.log(
        `[Main] migrated agent model bindings: backfilled=${backfilledAgentModels}, qualified=${qualifiedAgentModels}`,
      );
    }

    // One-time migration: move main agent workspace files from the user's
    // working directory to the fixed {STATE_DIR}/workspace-main/ path.
    try {
      const engineManager = getOpenClawEngineManager();
      migrateMainAgentWorkspace(
        engineManager.getStateDir(),
        getCoworkStore().getConfig().workingDirectory,
        getStore(),
      );
    } catch (err) {
      console.warn('[OpenClaw] main agent workspace migration failed (non-fatal):', err);
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

    profiler.mark('syncOpenClawConfig');
    const startupSync = await syncOpenClawConfig({
      reason: 'startup',
      restartGatewayIfRunning: false,
    });
    if (!startupSync.success) {
      console.error('[OpenClaw] Startup config sync failed:', startupSync.error);
    }
    profiler.measure('syncOpenClawConfig');
    void ensureOpenClawRunningForCowork()
      .then(() => {
        // Start cron polling once the gateway is confirmed running.
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] Canonical scheduler not available after startup:', err);
        }
      })
      .catch(error => {
        console.error('[OpenClaw] Failed to auto-start gateway on app startup:', error);
      });

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
    startAppUpdatePolling();

    // ── Step 2-4: Skill bootstrap (non-blocking) ────────────────────
    console.log('[Main] initApp: starting skill bootstrap');
    profiler.mark('skillManager');
    const manager = getSkillManager();
    console.log('[Main] initApp: getSkillManager done');

    // Inject SKILLS_ROOT into process.env so ALL subprocesses (Pi sessions,
    // shell tools spawned by the agent, skill scripts, etc.) inherit it.
    // Previously this was only set in OpenClaw's subprocess env and
    // getEnhancedEnv(), leaving Pi runtime sessions without this variable.
    const skillsRoot = getSkillsRoot().replace(/\\/g, '/');
    process.env.SKILLS_ROOT = skillsRoot;
    process.env.ZHIYUAN_SKILLS_ROOT = skillsRoot;
    console.log('[Main] initApp: SKILLS_ROOT =', skillsRoot);

    // When skills change (install/enable/disable/delete), re-sync AGENTS.md
    // so OpenClaw's IM channel agents pick up the latest skill list.
    manager.onSkillsChanged(() => {
      syncOpenClawConfig({ reason: 'skills-changed' }).catch(error => {
        console.warn('[Main] Failed to sync OpenClaw config after skills change:', error);
      });
    });

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

    // Enabled account records are owned by cc-connect. Do not start OpenClaw
    // gateways here: a release must never run both channel stacks.
    reconcileCcConnectChannelSidecars()
      .catch(error => {
        console.error('[cc-connect] Failed to auto-start enabled channel sidecars:', error);
      });

    // Reconnect OpenClaw gateway WS after system wake from sleep/suspend
    powerMonitor.on('resume', () => {
      if (openClawChannelGateway) {
        openClawChannelGateway.onSystemResume();
      }
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
          `${gwDiagTs()} proxy setting changed: ${previousUseSystemProxy} -> ${currentUseSystemProxy}, will restart gateway if running`,
        );
        void applyProxyPreference(currentUseSystemProxy).then(() => {
          if (getOpenClawEngineManager().getStatus().phase === 'running') {
            void syncOpenClawConfig({
              reason: 'system-proxy-changed',
              restartGatewayIfRunning: false,
            }).finally(() => {
              console.log(`${gwDiagTs()} restarting gateway after proxy change`);
              void getOpenClawEngineManager().restartGateway('proxy-change');
            });
          }
        });
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
      app.quit();
    }
  });
}
