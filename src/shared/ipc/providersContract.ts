/**
 * Provider-domain IPC contracts (channel + args + result), single source of
 * truth for the `providers` preload namespace, the main-side registrations it
 * reaches (agent profiles, magpie runtime, enterprise config/session/renderer,
 * managed providers + AISphere, community auth, model pool), and the
 * renderer-facing types under `src/renderer/types/electron/`.
 *
 * Arg/result shapes mirror what the renderer sends today (call sites noted per
 * method). Results are not stripped at runtime. The Magpie results are large
 * evolving projections owned by `src/shared/magpie/types.ts`, so their schemas
 * pin the envelope with `z.custom` casts, matching how the marketplace contract
 * treats catalog rows.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { CommunityAuthIpc, EnterpriseIpc, ManagedProviderIpc } from './channels';
import { AgentIpcChannel } from '../agent/constants';
import { AISphereIpc } from '../aisphere';
import { EnterpriseSessionIpc } from '../enterpriseSession';
import { EnterpriseRendererIpc } from '../enterpriseRenderer';
import { MagpieIpc } from './providersContract.channels';
import type {
  MagpieAgents,
  MagpieAgentConnectPreview,
  MagpieDiagnosticSummary,
  MagpieModelCatalog,
  MagpieProviderSummary,
  MagpieStatus,
  MagpieTestProviderResult,
} from '../magpie/types';
import type { MagpiePreferences, MagpiePreferencesPatch } from '../magpie/preferences';
import type {
  MagpieRoutingState,
  MagpieSubscriptionQuota,
  MagpieUsageBudget,
  MagpieUsagePeriod,
  MagpieUsageRequestPage,
  MagpieUsageSummary,
} from '../magpie/routingUsage';
import type { AISphereSnapshot } from '../aisphere';
import type { ManagedProviderAccessPolicy, ManagedProviderCatalogModel } from '../managedProviders';
import type { EnterpriseRendererSettingsPage } from '../enterpriseRenderer';
import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
} from '../enterpriseSession';

// Enterprise login/change-password inputs reuse the shared interfaces; the
// schemas below pin them as zod objects for runtime validation.
type EnterpriseLoginInput = EnterprisePasswordLoginInput;
type EnterprisePasswordChangeInputAlias = EnterprisePasswordChangeInput;

// ─── Schemas ────────────────────────────────────────────────────────────────

/** `AgentSource` from src/main/coworkStore/types.ts. */
const AgentSourceSchema = z.enum(['custom', 'preset', 'expert-package', 'expert-package-member']);

/** `Agent` row from src/main/coworkStore/types.ts (AgentManager-owned). */
const AgentRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  identity: z.string(),
  model: z.string(),
  workingDirectory: z.string(),
  icon: z.string(),
  skillIds: z.array(z.string()),
  mcpIds: z.array(z.string()).optional(),
  enabled: z.boolean(),
  pinned: z.boolean(),
  pinOrder: z.number().nullable().optional(),
  isDefault: z.boolean(),
  source: AgentSourceSchema,
  presetId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Agent reads and updates share this result. */
const AgentsEnvelopeSchema = z.object({
  success: z.boolean(),
  agents: z.array(AgentRecordSchema).optional(),
  agent: AgentRecordSchema.optional(),
  error: z.string().optional(),
});

/** `CreateAgentRequest` fields the renderer's agentService.createAgent sends. */
const CreateAgentRequestSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  identity: z.string().optional(),
  model: z.string().optional(),
  workingDirectory: z.string().optional(),
  icon: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  source: AgentSourceSchema.optional(),
  presetId: z.string().optional(),
});

/** `UpdateAgentRequest` — agentService.updateAgent sends a partial patch. */
const UpdateAgentRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  identity: z.string().optional(),
  model: z.string().optional(),
  workingDirectory: z.string().optional(),
  icon: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

/** Localized preset-expert catalog row (presetExpertCatalog.ts). */
const LocalizedTextSchema = z.object({ en: z.string(), zh: z.string() });

const ExpertPythonRequirementsSchema = z.object({
  requirementsPath: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
});

const ExpertSkillCatalogEntrySchema = z.object({
  id: z.string(),
  category: z.string(),
  install: z.string(),
  license: z.string().optional(),
});

const PresetExpertsResultSchema = z.object({
  experts: z.array(
    z.object({
      name: z.string(),
      displayName: LocalizedTextSchema,
      profession: LocalizedTextSchema,
      displayDescription: LocalizedTextSchema,
      categoryId: z.string(),
      tags: z.array(LocalizedTextSchema),
      quickPrompts: z.array(LocalizedTextSchema),
      workflow: z.array(z.string()),
      path: z.string(),
      mcpIds: z.array(z.string()),
      pythonRequirements: ExpertPythonRequirementsSchema.optional(),
      pypiMirrors: z.array(z.string()),
      skillCatalog: z.array(ExpertSkillCatalogEntrySchema),
    }),
  ),
  error: z.string().optional(),
});

/**
 * Magpie result envelopes. The manager owns these projections and the renderer
 * treats them as the shared interfaces, so validation only checks the envelope.
 */
const MagpieStatusSchema = z.custom<MagpieStatus>(value => typeof value === 'object');
const MagpieModelCatalogSchema = z.custom<MagpieModelCatalog>(value => typeof value === 'object');
const MagpieAgentsSchema = z.custom<MagpieAgents>(value => typeof value === 'object');
const MagpieAgentConnectPreviewSchema = z.custom<MagpieAgentConnectPreview>(
  value => typeof value === 'object',
);
const MagpieProviderSummariesSchema = z.custom<MagpieProviderSummary[]>(value =>
  Array.isArray(value),
);
const MagpieSaveProviderInputSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
  baseUrl: z.string(),
  key: z.string().optional(),
  models: z.array(z.string()),
  fallback: z.array(z.string()).optional(),
  contexts: z.record(z.string(), z.number().int().positive().max(100_000_000)).optional(),
});
const MagpieTestProviderResultSchema2 = z.custom<MagpieTestProviderResult>(
  value => typeof value === 'object',
);
const MagpieDiagnosticSummarySchema = z.custom<MagpieDiagnosticSummary>(
  value => typeof value === 'object',
);
const MagpiePreferencesSchema = z.custom<MagpiePreferences>(value => typeof value === 'object');
const MagpiePreferencesPatchSchema = z.custom<MagpiePreferencesPatch>(
  value => typeof value === 'object' && value !== null,
);
const MagpieUsagePeriodSchema = z.custom<MagpieUsagePeriod>(value => typeof value === 'string');
const MagpieRoutingStateSchema = z.custom<MagpieRoutingState>(value => typeof value === 'object');
const MagpieRoutingGroupSaveInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(z.string()),
  routing: z.string().optional(),
  affinity: z.string().optional(),
  off: z.array(z.string()).optional(),
  renameFrom: z.string().optional(),
});
const MagpieUsageSummarySchema = z.custom<MagpieUsageSummary>(value => typeof value === 'object');
const MagpieUsageRequestPageSchema = z.custom<MagpieUsageRequestPage>(
  value => typeof value === 'object',
);
const MagpieSubscriptionQuotaListSchema = z.custom<MagpieSubscriptionQuota[]>(value =>
  Array.isArray(value),
);
const MagpieUsageBudgetSchema = z.custom<MagpieUsageBudget>(value => typeof value === 'object');

/**
 * Enterprise config rows come from the enterprise_config KV blob; the renderer
 * reads the optional UI overlay fields, so only those are pinned.
 */
const EnterpriseConfigSchema = z
  .object({
    ui: z.record(z.string(), z.enum(['hide', 'disable', 'readonly'])).optional(),
    disableUpdate: z.boolean().optional(),
    version: z.string().optional(),
    name: z.string().optional(),
  })
  .nullable();

const EnterpriseSessionResultSchema = z.custom<EnterpriseSessionResult>(
  value => typeof value === 'object',
);

/** Login/changePassword inputs validated field-by-field by sessionBridge. */
const EnterpriseLoginInputSchema = z.object({
  aepBaseUrl: z.string(),
  enterpriseId: z.string(),
  username: z.string(),
  password: z.string(),
}) satisfies z.ZodType<EnterpriseLoginInput>;

const EnterprisePasswordChangeInputSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
}) satisfies z.ZodType<EnterprisePasswordChangeInputAlias>;

const EnterpriseSettingsPagesSchema = z.custom<readonly EnterpriseRendererSettingsPage[]>(value =>
  Array.isArray(value),
);

const ManagedProviderAccessPolicySchema = z.custom<ManagedProviderAccessPolicy>(
  value => typeof value === 'object',
);

const ManagedProviderCatalogSchema = z.custom<readonly ManagedProviderCatalogModel[]>(value =>
  Array.isArray(value),
);

const AISphereSnapshotSchema = z.custom<AISphereSnapshot>(value => typeof value === 'object');

// ─── Contract ───────────────────────────────────────────────────────────────

export const providersContract = defineIpcContract({
  // agents (agentService, ExpertManager)
  agentsList: {
    channel: AgentIpcChannel.List,
    args: z.tuple([]),
    result: AgentsEnvelopeSchema,
  },
  agentsGet: {
    channel: AgentIpcChannel.Get,
    args: z.tuple([z.string()]),
    result: AgentsEnvelopeSchema,
  },
  agentsCreate: {
    channel: AgentIpcChannel.Create,
    args: z.tuple([CreateAgentRequestSchema]),
    result: AgentsEnvelopeSchema,
  },
  agentsUpdate: {
    channel: AgentIpcChannel.Update,
    args: z.tuple([z.string(), UpdateAgentRequestSchema]),
    result: AgentsEnvelopeSchema,
  },
  agentsDelete: {
    channel: AgentIpcChannel.Delete,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      deleted: z.boolean().optional(),
      deletedSessionIds: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
  },
  agentsImportExpertPackage: {
    channel: AgentIpcChannel.ImportExpertPackage,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      agentIds: z.array(z.string()).optional(),
      expertType: z.string().optional(),
      name: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  agentsGetPresetExperts: {
    channel: AgentIpcChannel.GetPresetExperts,
    args: z.tuple([]),
    result: PresetExpertsResultSchema,
  },

  // enterprise (useAppBootstrap, LoginButton, EnterpriseSettingsPage/SessionGate)
  enterpriseGetConfig: {
    channel: EnterpriseIpc.GetConfig,
    args: z.tuple([]),
    result: EnterpriseConfigSchema,
  },
  enterpriseSessionGateEntrypoint: {
    channel: EnterpriseRendererIpc.SessionGateEntrypoint,
    args: z.tuple([]),
    result: z.string().nullable(),
  },
  enterpriseSettingsPages: {
    channel: EnterpriseRendererIpc.SettingsPages,
    args: z.tuple([]),
    result: EnterpriseSettingsPagesSchema,
  },
  enterpriseSessionSnapshot: {
    channel: EnterpriseSessionIpc.Snapshot,
    args: z.tuple([]),
    result: EnterpriseSessionResultSchema,
  },
  enterpriseSessionLogin: {
    channel: EnterpriseSessionIpc.Login,
    args: z.tuple([EnterpriseLoginInputSchema]),
    result: EnterpriseSessionResultSchema,
  },
  enterpriseSessionChangePassword: {
    channel: EnterpriseSessionIpc.ChangePassword,
    args: z.tuple([EnterprisePasswordChangeInputSchema]),
    result: EnterpriseSessionResultSchema,
  },
  enterpriseSessionLogout: {
    channel: EnterpriseSessionIpc.Logout,
    args: z.tuple([]),
    result: EnterpriseSessionResultSchema,
  },

  // managed providers (App bootstrap, AISphereSettings, enterpriseRenderer)
  managedProviderPolicy: {
    channel: ManagedProviderIpc.Policy,
    args: z.tuple([]),
    result: ManagedProviderAccessPolicySchema,
  },
  managedProviderCatalog: {
    channel: ManagedProviderIpc.Catalog,
    args: z.tuple([]),
    result: ManagedProviderCatalogSchema,
  },
  aisphereSnapshot: {
    channel: AISphereIpc.Snapshot,
    args: z.tuple([]),
    result: AISphereSnapshotSchema,
  },
  aisphereConnect: {
    channel: AISphereIpc.Connect,
    args: z.tuple([z.string()]),
    result: AISphereSnapshotSchema,
  },
  aisphereDisconnect: {
    channel: AISphereIpc.Disconnect,
    args: z.tuple([]),
    result: AISphereSnapshotSchema,
  },
  aisphereRefresh: {
    channel: AISphereIpc.Refresh,
    args: z.tuple([]),
    result: AISphereSnapshotSchema,
  },

  // community auth (LoginButton)
  authCommunityLogin: {
    channel: CommunityAuthIpc.Login,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  authGetCommunityUser: {
    channel: CommunityAuthIpc.GetCommunityUser,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      user: z.object({ id: z.string(), email: z.string() }).optional(),
    }),
  },
  authCommunityLogout: {
    channel: CommunityAuthIpc.Logout,
    args: z.tuple([]),
    result: z.object({ success: z.boolean() }),
  },
});

export const magpieContract = defineIpcContract({
  // magpie (ModelSettingsPanel, CodingAgentManager, MagpieSubscriptionControl,
  // useMagpiePreferences, availableModels)
  status: {
    channel: MagpieIpc.status,
    args: z.tuple([]),
    result: MagpieStatusSchema,
  },
  setSubscriptionAccounts: {
    channel: MagpieIpc.setSubscriptionAccounts,
    args: z.tuple([z.boolean()]),
    result: MagpieStatusSchema,
  },
  start: {
    channel: MagpieIpc.start,
    args: z.tuple([]),
    result: MagpieStatusSchema,
  },
  stop: {
    channel: MagpieIpc.stop,
    args: z.tuple([]),
    result: MagpieStatusSchema,
  },
  agents: {
    channel: MagpieIpc.agents,
    args: z.tuple([]),
    result: MagpieAgentsSchema,
  },
  setModel: {
    channel: MagpieIpc.setModel,
    args: z.tuple([z.object({ agentId: z.string(), field: z.string(), value: z.string() })]),
    result: MagpieAgentsSchema,
  },
  previewAgent: {
    channel: MagpieIpc.previewAgent,
    args: z.tuple([z.string()]),
    result: MagpieAgentConnectPreviewSchema,
  },
  connectAgent: {
    channel: MagpieIpc.connectAgent,
    args: z.tuple([z.string()]),
    result: MagpieAgentsSchema,
  },
  disconnectAgent: {
    channel: MagpieIpc.disconnectAgent,
    args: z.tuple([z.string()]),
    result: MagpieAgentsSchema,
  },
  disconnectAllAgents: {
    channel: MagpieIpc.disconnectAllAgents,
    args: z.tuple([]),
    result: MagpieAgentsSchema,
  },
  catalog: {
    channel: MagpieIpc.catalog,
    args: z.tuple([]),
    result: MagpieModelCatalogSchema,
  },
  selectDefault: {
    channel: MagpieIpc.selectDefault,
    args: z.tuple([z.string()]),
    result: MagpieModelCatalogSchema,
  },
  providers: {
    channel: MagpieIpc.providers,
    args: z.tuple([]),
    result: MagpieProviderSummariesSchema,
  },
  saveProvider: {
    channel: MagpieIpc.saveProvider,
    args: z.tuple([MagpieSaveProviderInputSchema]),
    result: MagpieProviderSummariesSchema,
  },
  setProviderEnabled: {
    channel: MagpieIpc.setProviderEnabled,
    args: z.tuple([z.string(), z.boolean()]),
    result: MagpieProviderSummariesSchema,
  },
  deleteProvider: {
    channel: MagpieIpc.deleteProvider,
    args: z.tuple([z.string()]),
    result: MagpieProviderSummariesSchema,
  },
  testProvider: {
    channel: MagpieIpc.testProvider,
    args: z.tuple([MagpieSaveProviderInputSchema]),
    result: MagpieTestProviderResultSchema2,
  },
  diagnostics: {
    channel: MagpieIpc.diagnostics,
    args: z.tuple([]),
    result: MagpieDiagnosticSummarySchema,
  },
  clearDiagnostics: {
    channel: MagpieIpc.clearDiagnostics,
    args: z.tuple([]),
    result: MagpieDiagnosticSummarySchema,
  },
  preferences: {
    channel: MagpieIpc.preferences,
    args: z.tuple([]),
    result: MagpiePreferencesSchema,
  },
  updatePreferences: {
    channel: MagpieIpc.updatePreferences,
    args: z.tuple([MagpiePreferencesPatchSchema]),
    result: MagpiePreferencesSchema,
  },
  routingGroups: {
    channel: MagpieIpc.routingGroups,
    args: z.tuple([]),
    result: MagpieRoutingStateSchema,
  },
  saveRoutingGroup: {
    channel: MagpieIpc.saveRoutingGroup,
    args: z.tuple([MagpieRoutingGroupSaveInputSchema]),
    result: MagpieRoutingStateSchema,
  },
  deleteRoutingGroup: {
    channel: MagpieIpc.deleteRoutingGroup,
    args: z.tuple([z.string()]),
    result: MagpieRoutingStateSchema,
  },
  arrangeRoutingGroups: {
    channel: MagpieIpc.arrangeRoutingGroups,
    args: z.tuple([z.array(z.string())]),
    result: MagpieRoutingStateSchema,
  },
  usageSummary: {
    channel: MagpieIpc.usageSummary,
    args: z.tuple([MagpieUsagePeriodSchema]),
    result: MagpieUsageSummarySchema,
  },
  usageRequests: {
    channel: MagpieIpc.usageRequests,
    args: z.tuple([MagpieUsagePeriodSchema, z.number(), z.number()]),
    result: MagpieUsageRequestPageSchema,
  },
  usageQuotas: {
    channel: MagpieIpc.usageQuotas,
    args: z.tuple([z.boolean().optional()]),
    result: MagpieSubscriptionQuotaListSchema,
  },
  usageBudget: {
    channel: MagpieIpc.usageBudget,
    args: z.tuple([]),
    result: MagpieUsageBudgetSchema,
  },
});
