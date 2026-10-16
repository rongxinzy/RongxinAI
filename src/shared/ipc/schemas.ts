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

import { CoworkExecutionMode, CoworkPermissionMode, CoworkSessionMode } from '../cowork/constants';
import { hasCoworkSubmissionContent } from '../cowork/submissionContent';
import { ApiRequestPurpose } from './apiRequest';
import { ApiFormat, ModelCapabilityStatus, ProviderModelDiscoveryErrorCode } from '../providers';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Standard error envelope. */
const IpcError = z.object({ success: z.literal(false), error: z.string().optional() });

/** Generic IPC result — { success: true, ...data } | { success: false, error? } */
const IpcResult = <T extends z.ZodRawShape>(data: T) =>
  z.union([z.object({ success: z.literal(true), ...data }), IpcError]);

// ─── Store ──────────────────────────────────────────────────────────────────

// ─── Skills ─────────────────────────────────────────────────────────────────

// ─── MCP ────────────────────────────────────────────────────────────────────

// ─── API ────────────────────────────────────────────────────────────────────

export const ApiFetchSchema = {
  input: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    headers: z.record(z.string(), z.string()),
    body: z.string().optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
    purpose: z.literal(ApiRequestPurpose.ConnectivityTest).optional(),
  }),
  output: z.object({ status: z.number(), data: z.unknown() }).passthrough(),
};

export const ModelPoolStreamSchema = {
  input: z.object({
    conversationId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/u),
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

// ─── Window ─────────────────────────────────────────────────────────────────

// ─── Cowork Session ─────────────────────────────────────────────────────────

// path is intentionally absent. Zod strips it, so the main process copies the
// bytes into userData/cowork-images. Keeping a temp or workspace path makes
// the thumbnail and later model turns point at a file that gets cleaned up.
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
  input: z
    .object({
      prompt: z.string(),
      cwd: z.string().optional(),
      systemPrompt: z.string().optional(),
      title: z.string().optional(),
      mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]).optional(),
      goalMode: z.boolean().optional(),
      activeSkillIds: z.array(z.string()).optional(),
      workspaceId: z.string().optional(),
      agentId: z.string().optional(),
      expertIds: z.array(z.string().min(1)).max(1).optional(),
      modelOverride: z.string().optional(),
      permissionMode: z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]).optional(),
      imageAttachments: z.array(ImageAttachmentSchema).optional(),
      fileAttachments: z.array(FileAttachmentSchema).optional(),
    })
    .refine(hasCoworkSubmissionContent, { message: 'Prompt is required.', path: ['prompt'] }),
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
  input: z
    .object({
      sessionId: z.string().min(1),
      prompt: z.string(),
      systemPrompt: z.string().optional(),
      activeSkillIds: z.array(z.string()).optional(),
      goalMode: z.boolean().optional(),
      expertIds: z.array(z.string().min(1)).max(1).optional(),
      permissionMode: z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]).optional(),
      imageAttachments: z.array(ImageAttachmentSchema).optional(),
      fileAttachments: z.array(FileAttachmentSchema).optional(),
    })
    .refine(hasCoworkSubmissionContent, { message: 'Prompt is required.', path: ['prompt'] }),
  output: IpcResult({ engineStatus: z.object({}).passthrough().optional() }),
};

export const CoworkSessionUpdateModelSchema = {
  input: z.object({ sessionId: z.string().min(1), modelOverride: z.string() }),
  output: IpcResult({ session: z.object({}).passthrough().nullable().optional() }),
};

// ─── Cowork Permission ──────────────────────────────────────────────────────

// ─── Cowork Config ──────────────────────────────────────────────────────────

export const CoworkConfigSetSchema = {
  input: z.object({
    workingDirectory: z.string().optional(),
    executionMode: z.enum(CoworkExecutionMode).optional(),
    embeddingEnabled: z.boolean().optional(),
    embeddingProvider: z.string().optional(),
    embeddingModel: z.string().optional(),
    embeddingLocalModelPath: z.string().optional(),
    embeddingVectorWeight: z.number().optional(),
    embeddingRemoteBaseUrl: z.string().optional(),
    embeddingRemoteApiKey: z.string().optional(),
    codemodeEnabled: z.boolean().optional(),
    mcpNativeBridge: z.boolean().optional(),
  }),
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

// ─── Shell ──────────────────────────────────────────────────────────────────

// ─── Auth ───────────────────────────────────────────────────────────────────

// ─── App ────────────────────────────────────────────────────────────────────

// ─── Log ────────────────────────────────────────────────────────────────────

// ─── IM ─────────────────────────────────────────────────────────────────────

// ─── IM Instance ────────────────────────────────────────────────────────────

// ─── Feishu Install ─────────────────────────────────────────────────────────

// ─── DingTalk Install ───────────────────────────────────────────────────────

// ─── GitHub Copilot ─────────────────────────────────────────────────────────

// ─── OpenAI Codex OAuth ─────────────────────────────────────────────────────

// ─── Cowork Stream Events (main → renderer push) ────────────────────────────

// ─── Agent Engine ──────────────────────────────────────────────────────────

// ─── App Config ─────────────────────────────────────────────────────────────

// ─── Network ────────────────────────────────────────────────────────────────
