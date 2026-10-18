/**
 * Skill IPC contracts (channel + args + result), single source of truth for
 * `skillsIpc` handlers, the `skills` preload namespace, and the renderer
 * `SkillsApi` types.
 *
 * Arg/result shapes mirror what the renderer sends today
 * (`src/renderer/services/skill.ts` + skill components). Result envelopes are
 * intentionally loose where main returns rich records (`passthrough`) — the
 * main-side `SkillRecord` stays the owner of that shape.
 */
import { z } from 'zod';

import { defineIpcContract, type IpcContractChannels } from './contract';
import { SkillsIpc } from './channels';

/** A skill row as returned by SkillManager.listSkills() (main-owned SkillRecord). */
export const SkillRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    pinned: z.boolean(),
    isOfficial: z.boolean(),
    isBuiltIn: z.boolean(),
    updatedAt: z.number(),
    prompt: z.string(),
    skillPath: z.string(),
    iconUrl: z.string().optional(),
    displayName: z.string().optional(),
    displayDescription: z.string().optional(),
    displayAuthor: z.string().optional(),
    displayLicense: z.string().optional(),
    metadataContent: z.string().optional(),
    metadataFields: z.record(z.string(), z.string()).optional(),
    version: z.string().optional(),
  })
  .passthrough();

export type SkillRecordIpc = z.infer<typeof SkillRecordSchema>;

/** `{ success: true, skills } | { success: false, error? }` envelope. */
const SkillsEnvelopeSchema = z.object({
  success: z.boolean(),
  skills: z.array(SkillRecordSchema).optional(),
  error: z.string().optional(),
});

const SkillConfigSchema = z.record(z.string(), z.string());

const EmailConnectivityCheckSchema = z.object({
  code: z.enum(['imap_connection', 'smtp_connection']),
  level: z.enum(['pass', 'fail']),
  message: z.string(),
  durationMs: z.number(),
});

export const EmailConnectivityTestResultSchema = z.object({
  testedAt: z.number(),
  verdict: z.enum(['pass', 'fail']),
  checks: z.array(EmailConnectivityCheckSchema),
});

export type EmailConnectivityTestResultIpc = z.infer<typeof EmailConnectivityTestResultSchema>;

export const skillsContract = defineIpcContract({
  list: {
    channel: SkillsIpc.List,
    args: z.tuple([]),
    result: SkillsEnvelopeSchema,
  },
  setEnabled: {
    channel: SkillsIpc.SetEnabled,
    args: z.tuple([z.object({ id: z.string(), enabled: z.boolean() })]),
    result: SkillsEnvelopeSchema,
  },
  setEnabledBatch: {
    channel: SkillsIpc.SetEnabledBatch,
    args: z.tuple([z.object({ ids: z.array(z.string()), enabled: z.boolean() })]),
    result: SkillsEnvelopeSchema,
  },
  setPinned: {
    channel: SkillsIpc.SetPinned,
    args: z.tuple([z.object({ id: z.string(), pinned: z.boolean() })]),
    result: SkillsEnvelopeSchema,
  },
  delete: {
    channel: SkillsIpc.Delete,
    args: z.tuple([z.string()]),
    result: SkillsEnvelopeSchema,
  },
  download: {
    channel: SkillsIpc.Download,
    args: z.tuple([
      z.string(),
      z
        .object({
          iconUrl: z.string().optional(),
          displayName: z.string().optional(),
        })
        .optional(),
    ]),
    result: z.object({
      success: z.boolean(),
      skills: z.array(SkillRecordSchema).optional(),
      error: z.string().optional(),
      errorCode: z.string().optional(),
      auditReport: z.unknown().optional(),
      pendingInstallId: z.string().optional(),
    }),
  },
  confirmInstall: {
    channel: SkillsIpc.ConfirmInstall,
    args: z.tuple([z.string(), z.enum(['install', 'installDisabled', 'cancel'])]),
    result: SkillsEnvelopeSchema,
  },
  getRoot: {
    channel: SkillsIpc.GetRoot,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  getContent: {
    channel: SkillsIpc.GetContent,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      content: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  autoRoutingPrompt: {
    channel: SkillsIpc.AutoRoutingPrompt,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      prompt: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  getConfig: {
    channel: SkillsIpc.GetConfig,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      config: SkillConfigSchema.optional(),
      error: z.string().optional(),
    }),
  },
  setConfig: {
    channel: SkillsIpc.SetConfig,
    args: z.tuple([z.string(), SkillConfigSchema]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  testEmailConnectivity: {
    channel: SkillsIpc.TestEmailConnectivity,
    args: z.tuple([z.string(), SkillConfigSchema]),
    result: z.object({
      success: z.boolean(),
      result: EmailConnectivityTestResultSchema.optional(),
      error: z.string().optional(),
    }),
  },
  fetchMarketplace: {
    channel: SkillsIpc.FetchMarketplace,
    args: z.tuple([
      z
        .object({
          pageNumber: z.number().optional(),
          pageSize: z.number().optional(),
        })
        .optional(),
    ]),
    // Raw ModelScope OpenAPI JSON payload; the renderer JSON.parse()s it.
    result: z.object({
      success: z.boolean(),
      data: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  fetchMarketplaceContent: {
    channel: SkillsIpc.FetchMarketplaceContent,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      content: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  createCustom: {
    channel: SkillsIpc.CreateCustom,
    args: z.tuple([
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        content: z.string(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      skill: SkillRecordSchema.optional(),
      error: z.string().optional(),
    }),
  },
});

/** Preload channel map for the skills namespace (zod-free values). */
export const skillsContractChannels: IpcContractChannels<typeof skillsContract> = {
  list: SkillsIpc.List,
  setEnabled: SkillsIpc.SetEnabled,
  setEnabledBatch: SkillsIpc.SetEnabledBatch,
  setPinned: SkillsIpc.SetPinned,
  delete: SkillsIpc.Delete,
  download: SkillsIpc.Download,
  confirmInstall: SkillsIpc.ConfirmInstall,
  getRoot: SkillsIpc.GetRoot,
  getContent: SkillsIpc.GetContent,
  autoRoutingPrompt: SkillsIpc.AutoRoutingPrompt,
  getConfig: SkillsIpc.GetConfig,
  setConfig: SkillsIpc.SetConfig,
  testEmailConnectivity: SkillsIpc.TestEmailConnectivity,
  fetchMarketplace: SkillsIpc.FetchMarketplace,
  fetchMarketplaceContent: SkillsIpc.FetchMarketplaceContent,
  createCustom: SkillsIpc.CreateCustom,
} as const;
