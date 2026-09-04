/**
 * IPC Zod schemas for input/output validation at the main process boundary.
 *
 * Every ipcMain.handle handler should validate its input with the corresponding
 * schema before processing, and return output that conforms to the output schema.
 *
 * Pattern:
 *   import { CoworkSessionStartSchema } from '@shared/ipc/schemas';
 *   const input = CoworkSessionStartSchema.input.parse(rawInput);
 */

import { z } from 'zod';

import { CoworkPermissionMode, CoworkSessionMode } from '../cowork/constants';
import { ProductionLoopMode } from '../productionLoop';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../cowork/toolActivity';
import { ApiFormat, ModelCapabilityStatus, ProviderModelDiscoveryErrorCode } from '../providers';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Standard error envelope. */
export const IpcError = z.object({ success: z.literal(false), error: z.string().optional() });

/** Generic IPC result — { success: true, ...data } | { success: false, error? } */
export const IpcResult = <T extends z.ZodRawShape>(data: T) =>
  z.union([z.object({ success: z.literal(true), ...data }), IpcError]);

// ─── Store ──────────────────────────────────────────────────────────────────

export const StoreGetSchema = {
  input: z.object({ key: z.string().min(1) }),
  output: z.any(),
};

export const StoreSetSchema = {
  input: z.object({ key: z.string().min(1), value: z.any() }),
  output: z.void(),
};

export const StoreRemoveSchema = {
  input: z.object({ key: z.string().min(1) }),
  output: z.void(),
};

// ─── Skills ─────────────────────────────────────────────────────────────────

export const SkillsSetEnabledSchema = {
  input: z.object({ id: z.string().min(1), enabled: z.boolean() }),
  output: IpcResult({}),
};

export const SkillsDeleteSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const SkillsDownloadSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const SkillsUpgradeSchema = {
  input: z.tuple([z.string().min(1), z.string().min(1)]),
  output: IpcResult({}),
};

export const SkillsConfirmInstallSchema = {
  input: z.tuple([z.string().min(1), z.string().min(1)]),
  output: IpcResult({}),
};

export const SkillsGetConfigSchema = {
  input: z.string().min(1),
  output: z.record(z.string(), z.string()).nullable(),
};

export const SkillsSetConfigSchema = {
  input: z.object({ skillId: z.string().min(1), config: z.record(z.string(), z.string()) }),
  output: IpcResult({}),
};

export const SkillsTestEmailConnectivitySchema = {
  input: z.object({ skillId: z.string().min(1), config: z.record(z.string(), z.string()) }),
  output: IpcResult({}),
};

// ─── MCP ────────────────────────────────────────────────────────────────────

export const McpCreateSchema = {
  input: z.object({}).passthrough(),
  output: IpcResult({}),
};

export const McpUpdateSchema = {
  input: z.object({ id: z.string().min(1) }).passthrough(),
  output: IpcResult({}),
};

export const McpDeleteSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const McpSetEnabledSchema = {
  input: z.object({ id: z.string().min(1), enabled: z.boolean() }),
  output: IpcResult({}),
};

export const McpBridgeSyncDoneSchema = {
  output: z.object({ tools: z.number(), error: z.string().optional() }),
};

// ─── API ────────────────────────────────────────────────────────────────────

export const ApiFetchSchema = {
  input: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    headers: z.record(z.string(), z.string()),
    body: z.string().optional(),
  }),
  output: z.object({ status: z.number(), data: z.unknown() }).passthrough(),
};

export const ModelPoolStreamSchema = {
  input: z.object({
    requestId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/u),
    body: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    ok: z.boolean(),
    status: z.number(),
    statusText: z.string(),
    error: z.string().optional(),
  }),
};

export const ModelPoolModelsSchema = {
  output: z.object({
    ok: z.boolean(),
    status: z.number(),
    models: z.array(z.string()),
    error: z.string().optional(),
  }),
};

export const ProviderModelDiscoverySchema = {
  input: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
    apiFormat: z.enum([ApiFormat.OpenAI, ApiFormat.Anthropic, ApiFormat.Gemini]),
  }),
  output: z.union([
    z.object({
      success: z.literal(true),
      models: z.array(
        z.object({
          id: z.string().min(1),
          displayName: z.string().optional(),
          ownedBy: z.string().optional(),
          contextWindow: z.number().int().positive().optional(),
          maxTokens: z.number().int().positive().optional(),
          capabilities: z
            .object({
              toolCalling: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
              imageInput: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
              videoInput: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
              audioInput: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
              documentInput: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
              reasoning: z
                .enum([
                  ModelCapabilityStatus.Supported,
                  ModelCapabilityStatus.Unsupported,
                  ModelCapabilityStatus.Unknown,
                ])
                .optional(),
            })
            .optional(),
        }),
      ),
    }),
    z.object({
      success: z.literal(false),
      code: z.enum([
        ProviderModelDiscoveryErrorCode.InvalidConfig,
        ProviderModelDiscoveryErrorCode.Authentication,
        ProviderModelDiscoveryErrorCode.EndpointNotFound,
        ProviderModelDiscoveryErrorCode.Timeout,
        ProviderModelDiscoveryErrorCode.UnsupportedFormat,
        ProviderModelDiscoveryErrorCode.ResponseTooLarge,
        ProviderModelDiscoveryErrorCode.Network,
        ProviderModelDiscoveryErrorCode.Http,
      ]),
      error: z.string(),
    }),
  ]),
};

export const ApiStreamSchema = {
  input: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST']),
    headers: z.record(z.string(), z.string()),
    body: z.string().optional(),
    requestId: z.string().min(1),
  }),
  output: z.void(),
};

// ─── Window ─────────────────────────────────────────────────────────────────

export const WindowShowSystemMenuSchema = {
  input: z.object({ x: z.number().optional(), y: z.number().optional() }),
};

export const WindowStateChangedSchema = {
  output: z.object({ isMaximized: z.boolean(), isFullscreen: z.boolean(), isFocused: z.boolean() }),
};

// ─── Cowork Session ─────────────────────────────────────────────────────────

const ImageAttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64Data: z.string(),
});
const FileAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  extension: z.string(),
  isImage: z.boolean().optional(),
});

export const CoworkSessionStartSchema = {
  input: z.object({
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    systemPrompt: z.string().optional(),
    title: z.string().optional(),
    mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]).optional(),
    goalMode: z.boolean().optional(),
    productionLoopMode: z.enum([ProductionLoopMode.Auto, ProductionLoopMode.Off]).optional(),
    activeSkillIds: z.array(z.string()).optional(),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    expertIds: z.array(z.string().min(1)).max(1).optional(),
    modelOverride: z.string().optional(),
    permissionMode: z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]).optional(),
    imageAttachments: z.array(ImageAttachmentSchema).optional(),
    fileAttachments: z.array(FileAttachmentSchema).optional(),
  }),
  output: IpcResult({
    session: z
      .object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
      })
      .passthrough(),
    engineStatus: z.object({}).passthrough().optional(),
  }),
};

export const CoworkSessionContinueSchema = {
  input: z.object({
    sessionId: z.string().min(1),
    prompt: z.string(),
    systemPrompt: z.string().optional(),
    activeSkillIds: z.array(z.string()).optional(),
    goalMode: z.boolean().optional(),
    productionLoopMode: z.enum([ProductionLoopMode.Auto, ProductionLoopMode.Off]).optional(),
    expertIds: z.array(z.string().min(1)).max(1).optional(),
    permissionMode: z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]).optional(),
    imageAttachments: z.array(ImageAttachmentSchema).optional(),
    fileAttachments: z.array(FileAttachmentSchema).optional(),
  }),
  output: IpcResult({ engineStatus: z.object({}).passthrough().optional() }),
};

export const CoworkSessionStopSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const CoworkSessionDeleteSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const CoworkSessionDeleteBatchSchema = {
  input: z.array(z.string().min(1)),
  output: IpcResult({}),
};

export const CoworkSessionPinSchema = {
  input: z.object({ sessionId: z.string().min(1), pinned: z.boolean() }),
  output: IpcResult({ pinOrder: z.number().nullable().optional() }),
};

export const CoworkSessionRenameSchema = {
  input: z.object({ sessionId: z.string().min(1), title: z.string().min(1) }),
  output: IpcResult({}),
};

export const CoworkSessionUpdateModelSchema = {
  input: z.object({ sessionId: z.string().min(1), modelOverride: z.string() }),
  output: IpcResult({ session: z.object({}).passthrough().nullable().optional() }),
};

export const CoworkSessionGetSchema = {
  input: z.string().min(1),
  output: IpcResult({ session: z.object({}).passthrough() }),
};

export const CoworkSessionListSchema = {
  input: z
    .object({
      limit: z.number().int().positive().optional(),
      offset: z.number().int().min(0).optional(),
      workspaceId: z.string().optional(),
      agentId: z.string().optional(),
    })
    .optional(),
  output: IpcResult({
    sessions: z.array(z.object({}).passthrough()),
    hasMore: z.boolean().optional(),
  }),
};

export const CoworkSessionGetMessagesSchema = {
  input: z.object({
    sessionId: z.string().min(1),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().min(0).optional(),
  }),
  output: IpcResult({
    messages: z.array(z.object({}).passthrough()),
    offset: z.number().int().min(0).optional(),
    total: z.number().int().min(0).optional(),
  }),
};

export const CoworkSessionExportResultImageSchema = {
  input: z.object({
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    defaultFileName: z.string().optional(),
  }),
  output: IpcResult({ path: z.string().optional(), canceled: z.boolean().optional() }),
};

export const CoworkSessionCaptureImageChunkSchema = {
  input: z.object({
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  }),
  output: IpcResult({
    width: z.number().optional(),
    height: z.number().optional(),
    pngBase64: z.string().optional(),
  }),
};

export const CoworkSessionSaveResultImageSchema = {
  input: z.object({
    pngBase64: z.string().min(1),
    defaultFileName: z.string().optional(),
  }),
  output: IpcResult({ path: z.string().optional(), canceled: z.boolean().optional() }),
};

export const CoworkSessionExportTextSchema = {
  input: z.object({
    content: z.string(),
    defaultFileName: z.string().optional(),
    fileExtension: z.string().optional(),
  }),
  output: IpcResult({ path: z.string().optional(), canceled: z.boolean().optional() }),
};

// ─── Cowork Permission ──────────────────────────────────────────────────────

export const CoworkPermissionRespondSchema = {
  input: z.object({
    requestId: z.string().min(1),
    result: z.object({}).passthrough(),
  }),
  output: IpcResult({}),
};

// ─── Cowork Config ──────────────────────────────────────────────────────────

export const CoworkConfigSetSchema = {
  input: z.object({
    workingDirectory: z.string().optional(),
    executionMode: z.enum(['auto', 'local', 'sandbox']).optional(),
    embeddingEnabled: z.boolean().optional(),
    embeddingProvider: z.string().optional(),
    embeddingModel: z.string().optional(),
    embeddingLocalModelPath: z.string().optional(),
    embeddingVectorWeight: z.number().optional(),
    embeddingRemoteBaseUrl: z.string().optional(),
    embeddingRemoteApiKey: z.string().optional(),
  }),
  output: IpcResult({}),
};

// ─── Cowork Bootstrap ───────────────────────────────────────────────────────

export const CoworkBootstrapReadSchema = {
  input: z.string().min(1),
  output: IpcResult({ content: z.string().optional() }),
};

export const CoworkBootstrapWriteSchema = {
  input: z.object({ filename: z.string().min(1), content: z.string() }),
  output: IpcResult({}),
};

// ─── Project (working directory helpers) ────────────────────────────────────

export const ProjectCreateDirectorySchema = {
  input: z.object({
    name: z.string().min(1),
    baseDir: z.string().min(1).optional(),
  }),
  output: IpcResult({ path: z.string() }),
};

// ─── Dialog ─────────────────────────────────────────────────────────────────

export const DialogSelectFileSchema = {
  input: z
    .object({
      title: z.string().optional(),
      filters: z
        .array(
          z.object({
            name: z.string(),
            extensions: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
  output: z.string().nullable(),
};

export const DialogSelectFilesSchema = {
  input: z
    .object({
      title: z.string().optional(),
      filters: z
        .array(
          z.object({
            name: z.string(),
            extensions: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
  output: z.array(z.string()).nullable(),
};

export const DialogSaveInlineFileSchema = {
  input: z.object({
    dataBase64: z.string().min(1),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
    cwd: z.string().optional(),
  }),
  output: z.string().nullable(),
};

export const DialogReadFileAsDataUrlSchema = {
  input: z.string().min(1),
  output: z.string().nullable(),
};

export const DialogGenerateThumbnailSchema = {
  input: z.string().min(1),
  output: z.string().nullable(),
};

export const DialogShowMessageBoxSchema = {
  input: z.object({
    message: z.string().min(1),
    type: z.enum(['none', 'info', 'error', 'question', 'warning']).optional(),
    title: z.string().optional(),
  }),
  output: z.object({}).passthrough().nullable(),
};

// ─── Shell ──────────────────────────────────────────────────────────────────

export const ShellOpenPathSchema = {
  input: z.string().min(1),
  output: z.string().nullable(),
};

export const ShellShowItemInFolderSchema = {
  input: z.string().min(1),
  output: z.void(),
};

export const ShellOpenExternalSchema = {
  input: z.string().min(1),
  output: z.void(),
};

export const ShellOpenHtmlInBrowserSchema = {
  input: z.string().min(1),
  output: z.void(),
};

// ─── Auth ───────────────────────────────────────────────────────────────────

export const AuthLoginSchema = {
  input: z.object({ loginUrl: z.string().optional() }).optional(),
  output: z.object({}).passthrough().nullable(),
};

export const AuthExchangeSchema = {
  input: z.object({ code: z.string().min(1) }),
  output: z.object({}).passthrough().nullable(),
};

export const AuthGetUserSchema = {
  output: z.object({}).passthrough().nullable(),
};

export const AuthRefreshTokenSchema = {
  output: z.object({}).passthrough().nullable(),
};

export const AuthCallbackSchema = {
  output: z.object({ code: z.string() }),
};

// ─── App ────────────────────────────────────────────────────────────────────

export const AppSetAutoLaunchSchema = {
  input: z.boolean(),
  output: z.void(),
};

export const AppSetPreventSleepSchema = {
  input: z.boolean(),
  output: z.void(),
};

// ─── Log ────────────────────────────────────────────────────────────────────

export const LogFromRendererSchema = {
  input: z.object({
    level: z.string().min(1),
    tag: z.string().min(1),
    message: z.string().min(1),
  }),
};

// ─── IM ─────────────────────────────────────────────────────────────────────

export const ImConfigSetSchema = {
  input: z.object({
    config: z.object({}).passthrough(),
    options: z.object({ syncGateway: z.boolean().optional() }).optional(),
  }),
  output: z.void(),
};

export const ImGatewayStartSchema = {
  input: z.string().min(1),
  output: z.void(),
};

export const ImGatewayStopSchema = {
  input: z.string().min(1),
  output: z.void(),
};

export const ImGatewayTestSchema = {
  input: z.object({
    platform: z.string().min(1),
    configOverride: z.object({}).passthrough().optional(),
  }),
  output: z.void(),
};

export const ImPairingApproveSchema = {
  input: z.object({ platform: z.string().min(1), code: z.string().min(1) }),
  output: z.void(),
};

export const ImPairingRejectSchema = {
  input: z.object({ platform: z.string().min(1), code: z.string().min(1) }),
  output: z.void(),
};

export const ImPairingListSchema = {
  input: z.string().min(1),
  output: z.array(z.object({}).passthrough()),
};

// ─── IM Instance ────────────────────────────────────────────────────────────

export const ImInstanceAddSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const ImInstanceDeleteSchema = {
  input: z.string().min(1),
  output: IpcResult({}),
};

export const ImInstanceSetConfigSchema = {
  input: z.object({
    instanceId: z.string().min(1),
    config: z.object({}).passthrough(),
    options: z.object({ syncGateway: z.boolean().optional() }).optional(),
  }),
  output: IpcResult({}),
};

// ─── Feishu Install ─────────────────────────────────────────────────────────

export const FeishuInstallQrcodeSchema = {
  input: z.boolean(),
  output: z.object({
    url: z.string(),
    deviceCode: z.string(),
    interval: z.number(),
    expireIn: z.number(),
  }),
};

export const FeishuInstallPollSchema = {
  input: z.string().min(1),
  output: z.object({
    done: z.boolean(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    domain: z.string().optional(),
    error: z.string().optional(),
  }),
};

export const FeishuInstallVerifySchema = {
  input: z.object({ appId: z.string().min(1), appSecret: z.string().min(1) }),
  output: z.object({ success: z.boolean(), error: z.string().optional() }),
};

// ─── DingTalk Install ───────────────────────────────────────────────────────

export const DingTalkInstallQrcodeSchema = {
  output: z.object({
    url: z.string(),
    deviceCode: z.string(),
    interval: z.number(),
    expireIn: z.number(),
  }),
};

export const DingTalkInstallPollSchema = {
  input: z.string().min(1),
  output: z.object({
    done: z.boolean(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    error: z.string().optional(),
  }),
};

export const DingTalkInstallVerifySchema = {
  input: z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }),
  output: z.object({ success: z.boolean(), error: z.string().optional() }),
};

// ─── GitHub Copilot ─────────────────────────────────────────────────────────

export const GitHubCopilotPollSchema = {
  input: z.object({
    deviceCode: z.string().min(1),
    interval: z.number(),
    expiresIn: z.number(),
  }),
  output: z.object({
    success: z.boolean(),
    token: z.string().optional(),
    githubUser: z.string().optional(),
    baseUrl: z.string().optional(),
    error: z.string().optional(),
  }),
};

export const GitHubCopilotRefreshTokenSchema = {
  output: z.object({
    success: z.boolean(),
    token: z.string().optional(),
    baseUrl: z.string().optional(),
    error: z.string().optional(),
  }),
};

export const GitHubCopilotTokenUpdatedSchema = {
  output: z.object({ token: z.string(), baseUrl: z.string() }),
};

// ─── OpenAI Codex OAuth ─────────────────────────────────────────────────────

export const OpenAICodexOAuthStartSchema = {
  output: z.union([
    z.object({
      success: z.literal(true),
      email: z.string().nullable(),
      accountId: z.string().nullable(),
      expiresAt: z.number(),
    }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]),
};

export const OpenAICodexOAuthStatusSchema = {
  output: z.union([
    z.object({
      loggedIn: z.literal(true),
      email: z.string().nullable(),
      accountId: z.string().nullable(),
      expiresAt: z.number(),
    }),
    z.object({ loggedIn: z.literal(false) }),
  ]),
};

// ─── Cowork Stream Events (main → renderer push) ────────────────────────────

export const CoworkStreamMessageSchema = {
  output: z.object({ sessionId: z.string(), message: z.object({}).passthrough() }),
};

export const CoworkStreamMessageUpdateSchema = {
  output: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
};

export const CoworkStreamToolActivitySchema = {
  output: z.object({
    sessionId: z.string(),
    event: z.discriminatedUnion('type', [
      z.object({
        type: z.literal(CoworkToolActivityEventType.Upsert),
        activity: z.object({
          toolCallId: z.string(),
          phase: z.enum([CoworkToolActivityPhase.Preparing, CoworkToolActivityPhase.Running]),
          toolName: z.string().optional(),
          toolInput: z.record(z.string(), z.unknown()).optional(),
          updatedAt: z.number(),
        }),
      }),
      z.object({ type: z.literal(CoworkToolActivityEventType.Remove), toolCallId: z.string() }),
      z.object({ type: z.literal(CoworkToolActivityEventType.Clear) }),
    ]),
  }),
};

export const CoworkStreamPermissionSchema = {
  output: z.object({ sessionId: z.string(), request: z.object({}).passthrough() }),
};

export const CoworkStreamPermissionDismissSchema = {
  output: z.object({ requestId: z.string() }),
};

export const CoworkStreamCompleteSchema = {
  output: z.object({ sessionId: z.string(), claudeSessionId: z.string().nullable() }),
};

export const CoworkStreamErrorSchema = {
  output: z.object({ sessionId: z.string(), error: z.string() }),
};

export const CoworkSessionsChangedSchema = {
  output: z.object({ sessionId: z.string().optional() }),
};

// ─── Agent Engine ──────────────────────────────────────────────────────────

// ─── App Config ─────────────────────────────────────────────────────────────

export const AppConfigGetRecentCwdsSchema = {
  input: z.number().int().positive().optional(),
  output: z.array(z.string()),
};

// ─── Network ────────────────────────────────────────────────────────────────

export const NetworkStatusChangeSchema = {
  input: z.enum(['online', 'offline']),
};
