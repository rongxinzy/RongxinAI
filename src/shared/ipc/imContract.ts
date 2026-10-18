/**
 * IM IPC contracts (channel + args + result), single source of truth for the
 * IM gateway/instance handlers (`src/main/appBootstrap/imGatewayIpc.ts`,
 * `imInstanceIpc.ts`, `integrationsIpc.ts`), the `im`/`feishu`/`dingtalk`
 * preload namespaces, and the renderer `ImApi` types.
 *
 * Config payloads previously crossed IPC as `unknown`; the schemas here encode
 * the real per-platform config shapes (`src/main/im/types.ts`) that the
 * renderer settings forms send. `setConfig` and the per-instance config setters
 * receive partial patches — main merges them over stored defaults — so only the
 * field types are pinned, not their presence. Results document the envelope
 * fields the renderer reads; they are not stripped at runtime.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import {
  DingTalkInstallIpc,
  FeishuInstallIpc,
  ImIpc,
  ImInstanceIpc,
  WeixinInstallIpc,
} from './channels';
import { PlatformRegistry } from '../platform/constants';

const PlatformSchema = z.enum(PlatformRegistry.platforms);

const SyncOptionsSchema = z.object({ syncGateway: z.boolean().optional() });

const DmPolicySchema = z.enum(['open', 'pairing', 'allowlist', 'disabled']);

const GroupPolicySchema = z.enum(['open', 'allowlist', 'disabled']);

const DingTalkConfigSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string(),
  clientSecret: z.string(),
  dmPolicy: z.enum(['open', 'pairing', 'allowlist']),
  allowFrom: z.array(z.string()),
  groupPolicy: z.enum(['open', 'allowlist']),
  sessionTimeout: z.number(),
  separateSessionByConversation: z.boolean(),
  groupSessionScope: z.enum(['group', 'group_sender']),
  sharedMemoryAcrossConversations: z.boolean(),
  gatewayBaseUrl: z.string(),
  debug: z.boolean(),
});

const FeishuConfigSchema = z.object({
  enabled: z.boolean(),
  appId: z.string(),
  appSecret: z.string(),
  domain: z.string(),
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  groups: z.record(
    z.string(),
    z.object({
      requireMention: z.boolean().optional(),
      allowFrom: z.array(z.string()).optional(),
      systemPrompt: z.string().optional(),
    }),
  ),
  historyLimit: z.number(),
  streaming: z.boolean(),
  replyMode: z.enum(['auto', 'static', 'streaming']),
  blockStreaming: z.boolean(),
  footer: z.object({
    status: z.boolean().optional(),
    elapsed: z.boolean().optional(),
  }),
  blockStreamingCoalesce: z
    .object({
      minChars: z.number().optional(),
      maxChars: z.number().optional(),
      idleMs: z.number().optional(),
    })
    .optional(),
  mediaMaxMb: z.number(),
  debug: z.boolean(),
});

const TelegramConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  groups: z.record(
    z.string(),
    z.object({
      requireMention: z.boolean().optional(),
      allowFrom: z.array(z.string()).optional(),
      systemPrompt: z.string().optional(),
    }),
  ),
  historyLimit: z.number(),
  replyToMode: z.enum(['off', 'first', 'all']),
  linkPreview: z.boolean(),
  streaming: z.enum(['off', 'partial', 'block', 'progress']),
  mediaMaxMb: z.number(),
  proxy: z.string(),
  webhookUrl: z.string(),
  webhookSecret: z.string(),
  debug: z.boolean(),
});

const DiscordConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string(),
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  guilds: z.record(
    z.string(),
    z.object({
      requireMention: z.boolean().optional(),
      allowFrom: z.array(z.string()).optional(),
      systemPrompt: z.string().optional(),
    }),
  ),
  historyLimit: z.number(),
  streaming: z.enum(['off', 'partial', 'block', 'progress']),
  mediaMaxMb: z.number(),
  proxy: z.string(),
  debug: z.boolean(),
});

const QQConfigSchema = z.object({
  enabled: z.boolean(),
  appId: z.string(),
  appSecret: z.string(),
  dmPolicy: z.enum(['open', 'pairing', 'allowlist']),
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  historyLimit: z.number(),
  markdownSupport: z.boolean(),
  imageServerBaseUrl: z.string(),
  debug: z.boolean(),
});

const WecomConfigSchema = z.object({
  enabled: z.boolean(),
  botId: z.string(),
  secret: z.string(),
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  sendThinkingMessage: z.boolean(),
  debug: z.boolean(),
});

const WeixinConfigSchema = z.object({
  enabled: z.boolean(),
  accountId: z.string(),
  workspaceId: z.string(),
  token: z.string(),
  baseUrl: z.string(),
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()),
  groupPolicy: GroupPolicySchema,
  groupAllowFrom: z.array(z.string()),
  debug: z.boolean(),
});

const IMSettingsSchema = z.object({
  systemPrompt: z.string().optional(),
  skillsEnabled: z.boolean(),
});

/**
 * `IMGatewayConfigPatch`: per-channel partial patches plus partial weixin
 * (`configPatch.ts` — weixin is a keyed member of the gateway patch, not a
 * separate payload). Only field types are pinned, not presence.
 */
const IMGatewayConfigPatchSchema = z
  .object({
    dingtalk: z
      .object({ instances: z.array(DingTalkConfigSchema.partial()) })
      .partial()
      .optional(),
    feishu: z
      .object({ instances: z.array(FeishuConfigSchema.partial()) })
      .partial()
      .optional(),
    telegram: z
      .object({ instances: z.array(TelegramConfigSchema.partial()) })
      .partial()
      .optional(),
    qq: z
      .object({ instances: z.array(QQConfigSchema.partial()) })
      .partial()
      .optional(),
    discord: z
      .object({ instances: z.array(DiscordConfigSchema.partial()) })
      .partial()
      .optional(),
    wecom: z
      .object({ instances: z.array(WecomConfigSchema.partial()) })
      .partial()
      .optional(),
    weixin: WeixinConfigSchema.partial().optional(),
    settings: IMSettingsSchema.partial().optional(),
  })
  .optional();

const ConnectivityCheckSchema = z.object({
  code: z.string(),
  level: z.enum(['pass', 'info', 'warn', 'fail']),
  message: z.string(),
  suggestion: z.string().optional(),
});

const ConnectivityTestResultSchema = z.object({
  platform: PlatformSchema,
  testedAt: z.number(),
  verdict: z.enum(['pass', 'warn', 'fail']),
  checks: z.array(ConnectivityCheckSchema),
});

/** Instance-scoped configs: channel config plus the per-instance identity. */
const DingTalkInstanceFullSchema = DingTalkConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});
const QQInstanceFullSchema = QQConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});
const FeishuInstanceFullSchema = FeishuConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});
const WecomInstanceFullSchema = WecomConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});
const TelegramInstanceFullSchema = TelegramConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});
const DiscordInstanceFullSchema = DiscordConfigSchema.extend({
  instanceId: z.string(),
  instanceName: z.string(),
  workspaceId: z.string(),
});

/** Per-instance config setter args: patch + optional gateway sync. */
function instanceConfigSetArgs(config: z.ZodTypeAny) {
  return z.tuple([z.string(), config, SyncOptionsSchema.optional()]);
}

function instanceEnvelope<T extends z.ZodType>(instance: T) {
  return z.object({
    success: z.boolean(),
    instance: instance.optional(),
    error: z.string().optional(),
  });
}

const SuccessResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export const imContract = defineIpcContract({
  getConfig: {
    channel: ImIpc.ConfigGet,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      config: z.unknown().optional(),
      error: z.string().optional(),
    }),
  },
  setConfig: {
    channel: ImIpc.ConfigSet,
    args: z.tuple([IMGatewayConfigPatchSchema, SyncOptionsSchema.optional()]),
    result: SuccessResultSchema,
  },
  syncConfig: {
    channel: ImIpc.ConfigSync,
    args: z.tuple([]),
    result: SuccessResultSchema,
  },
  startGateway: {
    channel: ImIpc.GatewayStart,
    args: z.tuple([PlatformSchema]),
    result: SuccessResultSchema,
  },
  stopGateway: {
    channel: ImIpc.GatewayStop,
    args: z.tuple([PlatformSchema]),
    result: SuccessResultSchema,
  },
  testGateway: {
    channel: ImIpc.GatewayTest,
    args: z.tuple([PlatformSchema, z.unknown().optional(), z.string().optional()]),
    result: z.object({
      success: z.boolean(),
      result: ConnectivityTestResultSchema.optional(),
      error: z.string().optional(),
    }),
  },
  getStatus: {
    channel: ImIpc.StatusGet,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      status: z.unknown().optional(),
      error: z.string().optional(),
    }),
  },
  getLocalIp: {
    channel: ImIpc.GetLocalIp,
    args: z.tuple([]),
    result: z.string(),
  },
  weixinLoginStart: {
    channel: WeixinInstallIpc.Start,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      status: z.enum(['wait', 'scaned', 'confirmed', 'expired']).optional(),
      qrcode: z.string().optional(),
      qrcodeUrl: z.string().optional(),
      errorCode: z.string().optional(),
    }),
  },
  weixinLoginPoll: {
    channel: WeixinInstallIpc.Poll,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      status: z.enum(['wait', 'scaned', 'confirmed', 'expired']),
      accountId: z.string().optional(),
      errorCode: z.string().optional(),
    }),
  },
});

/** Per-platform multi-instance add/delete/config-set, registered by `imInstanceIpc`. */
export const imInstanceContract = defineIpcContract({
  addDingTalkInstance: {
    channel: ImInstanceIpc.dingtalkAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(DingTalkInstanceFullSchema),
  },
  deleteDingTalkInstance: {
    channel: ImInstanceIpc.dingtalkDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setDingTalkInstanceConfig: {
    channel: ImInstanceIpc.dingtalkSetConfig,
    args: instanceConfigSetArgs(DingTalkConfigSchema.partial()),
    result: SuccessResultSchema,
  },
  addQQInstance: {
    channel: ImInstanceIpc.qqAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(QQInstanceFullSchema),
  },
  deleteQQInstance: {
    channel: ImInstanceIpc.qqDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setQQInstanceConfig: {
    channel: ImInstanceIpc.qqSetConfig,
    args: instanceConfigSetArgs(QQConfigSchema.partial()),
    result: SuccessResultSchema,
  },
  addFeishuInstance: {
    channel: ImInstanceIpc.feishuAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(FeishuInstanceFullSchema),
  },
  deleteFeishuInstance: {
    channel: ImInstanceIpc.feishuDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setFeishuInstanceConfig: {
    channel: ImInstanceIpc.feishuSetConfig,
    args: instanceConfigSetArgs(FeishuConfigSchema.partial()),
    result: SuccessResultSchema,
  },
  addWecomInstance: {
    channel: ImInstanceIpc.wecomAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(WecomInstanceFullSchema),
  },
  deleteWecomInstance: {
    channel: ImInstanceIpc.wecomDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setWecomInstanceConfig: {
    channel: ImInstanceIpc.wecomSetConfig,
    args: instanceConfigSetArgs(WecomConfigSchema.partial()),
    result: SuccessResultSchema,
  },
  addTelegramInstance: {
    channel: ImInstanceIpc.telegramAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(TelegramInstanceFullSchema),
  },
  deleteTelegramInstance: {
    channel: ImInstanceIpc.telegramDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setTelegramInstanceConfig: {
    channel: ImInstanceIpc.telegramSetConfig,
    args: instanceConfigSetArgs(TelegramConfigSchema.partial()),
    result: SuccessResultSchema,
  },
  addDiscordInstance: {
    channel: ImInstanceIpc.discordAdd,
    args: z.tuple([z.string(), z.string()]),
    result: instanceEnvelope(DiscordInstanceFullSchema),
  },
  deleteDiscordInstance: {
    channel: ImInstanceIpc.discordDelete,
    args: z.tuple([z.string()]),
    result: SuccessResultSchema,
  },
  setDiscordInstanceConfig: {
    channel: ImInstanceIpc.discordSetConfig,
    args: instanceConfigSetArgs(DiscordConfigSchema.partial()),
    result: SuccessResultSchema,
  },
});

export const feishuInstallContract = defineIpcContract({
  verify: {
    channel: FeishuInstallIpc.Verify,
    args: z.tuple([z.object({ appId: z.string(), appSecret: z.string() })]),
    result: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
});

export const dingtalkInstallContract = defineIpcContract({
  qrcode: {
    channel: DingTalkInstallIpc.Qrcode,
    args: z.tuple([]),
    result: z.object({
      url: z.string(),
      deviceCode: z.string(),
      interval: z.number().optional(),
      expireIn: z.number().optional(),
    }),
  },
  poll: {
    channel: DingTalkInstallIpc.Poll,
    args: z.tuple([z.object({ deviceCode: z.string() })]),
    result: z.object({
      done: z.boolean(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  verify: {
    channel: DingTalkInstallIpc.Verify,
    args: z.tuple([z.object({ clientId: z.string(), clientSecret: z.string() })]),
    result: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
});
