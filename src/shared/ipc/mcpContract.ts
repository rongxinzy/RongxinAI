/**
 * MCP server IPC contracts (channel + args + result), single source of truth
 * for `mcpIpc` handlers, the `mcp` preload namespace, and the renderer
 * `McpApi` types.
 *
 * `create`/`update`/`testConnection`/`authorize` previously accepted
 * `unknown`; the schemas here encode the real `McpServerFormData` shape the
 * renderer forms and connect flows send (`McpServerFormModal`,
 * `useMcpTokenConnect`, `useMcpOfficialConnect`). They intentionally do not
 * enforce transport-field pairing (command vs url) — that stays with
 * `validateMcpServerConfig`, which returns user-actionable error strings.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { McpIpc } from './channels';

export const McpTransportTypeSchema = z.enum(['stdio', 'sse', 'http']);
export type McpTransportTypeIpc = z.infer<typeof McpTransportTypeSchema>;

export const McpExposureSchema = z.enum(['codemode', 'deferred', 'direct', 'hidden']);
export type McpExposureIpc = z.infer<typeof McpExposureSchema>;

/** Stored MCP server row as returned by McpStore.listServers(). */
export const McpServerConfigSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    transportType: McpTransportTypeSchema,
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
    isBuiltIn: z.boolean(),
    githubUrl: z.string().optional(),
    registryId: z.string().optional(),
    exposure: McpExposureSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  });

export type McpServerConfigIpc = z.infer<typeof McpServerConfigSchema>;

const ServersEnvelopeSchema = z.object({
  success: z.boolean(),
  servers: z.array(McpServerConfigSchema).optional(),
  error: z.string().optional(),
});

/** Form payload the renderer sends to create/testConnection/authorize. */
export const McpServerFormSchema = z.object({
  name: z.string(),
  description: z.string(),
  transportType: McpTransportTypeSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
  isBuiltIn: z.boolean().optional(),
  githubUrl: z.string().optional(),
  registryId: z.string().optional(),
  exposure: McpExposureSchema.optional(),
});

export type McpServerFormIpc = z.infer<typeof McpServerFormSchema>;

/** Partial form payload for `update`; main merges it over the stored row. */
const McpServerFormPatchSchema = McpServerFormSchema.partial();

const McpPresentationLocaleSchema = z.object({
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
  connect: z
    .record(
      z.string(),
      z.object({ title: z.string().optional(), description: z.string().optional() }),
    )
    .optional(),
});

const McpPresentationSchema = z
  .object({
    name: z.string().optional(),
    authorization: z.string().optional(),
    zh: McpPresentationLocaleSchema.optional(),
    en: McpPresentationLocaleSchema.optional(),
  });

/** Bundled MCP marketplace registry entry (registry.json is permissive). */
export const McpMarketplaceServerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description_zh: z.string().optional(),
    description_en: z.string().optional(),
    category: z.string(),
    transportType: McpTransportTypeSchema,
    descriptionKey: z.string().optional(),
    categoryKey: z.string().optional(),
    command: z.string().optional(),
    defaultArgs: z.array(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    authType: z.enum(['oauth', 'cli', 'token', 'external']).optional(),
    connectorPath: z.string().optional(),
    iconPath: z.string().optional(),
    metadataPath: z.string().optional(),
    requiredEnvKeys: z.array(z.string()).optional(),
    optionalEnvKeys: z.array(z.string()).optional(),
    presentation: McpPresentationSchema.optional(),
  });

export type McpMarketplaceServerIpc = z.infer<typeof McpMarketplaceServerSchema>;

export const McpMarketplaceDataSchema = z.object({
  categories: z.array(z.object({ id: z.string(), name_zh: z.string(), name_en: z.string() })),
  servers: z.array(McpMarketplaceServerSchema),
});

export type McpMarketplaceDataIpc = z.infer<typeof McpMarketplaceDataSchema>;

export const mcpContract = defineIpcContract({
  list: {
    channel: McpIpc.List,
    args: z.tuple([]),
    result: ServersEnvelopeSchema,
  },
  create: {
    channel: McpIpc.Create,
    args: z.tuple([McpServerFormSchema]),
    result: ServersEnvelopeSchema,
  },
  update: {
    channel: McpIpc.Update,
    args: z.tuple([z.string(), McpServerFormPatchSchema]),
    result: ServersEnvelopeSchema,
  },
  delete: {
    channel: McpIpc.Delete,
    args: z.tuple([z.string()]),
    result: ServersEnvelopeSchema.extend({
      refreshError: z.string().optional(),
    }),
  },
  setEnabled: {
    channel: McpIpc.SetEnabled,
    args: z.tuple([z.object({ id: z.string(), enabled: z.boolean() })]),
    result: ServersEnvelopeSchema,
  },
  testConnection: {
    channel: McpIpc.TestConnection,
    args: z.tuple([McpServerFormSchema]),
    result: z
      .object({
        success: z.boolean(),
        error: z.string().optional(),
        toolCount: z.number().optional(),
      }),
  },
  fetchMarketplace: {
    channel: McpIpc.FetchMarketplace,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      data: McpMarketplaceDataSchema.optional(),
      error: z.string().optional(),
    }),
  },
  refreshBridge: {
    channel: McpIpc.RefreshBridge,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      tools: z.number(),
      error: z.string().optional(),
    }),
  },
  authorize: {
    channel: McpIpc.Authorize,
    args: z.tuple([McpServerFormSchema.extend({ authorizationRequestId: z.string().optional() })]),
    result: ServersEnvelopeSchema.extend({
      refreshError: z.string().optional(),
    }),
  },
  cancelAuthorize: {
    channel: McpIpc.CancelAuthorize,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean() }),
  },
  getFeishuCliStatus: {
    channel: McpIpc.GetFeishuCliStatus,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      installed: z.boolean(),
      error: z.string().optional(),
    }),
  },
  prepareFeishuCli: {
    channel: McpIpc.PrepareFeishuCli,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  loadIcon: {
    channel: McpIpc.LoadIcon,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      data: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  exportConfig: {
    channel: McpIpc.ExportConfig,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      cancelled: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  importConfig: {
    channel: McpIpc.ImportConfig,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      cancelled: z.boolean().optional(),
      servers: z.array(McpServerConfigSchema).optional(),
      error: z.string().optional(),
    }),
  },
  importConfigContent: {
    channel: McpIpc.ImportConfigContent,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      servers: z.array(McpServerConfigSchema).optional(),
      error: z.string().optional(),
    }),
  },
});
