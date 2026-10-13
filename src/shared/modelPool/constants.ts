export const ZhiyuanModelPool = {
  ProviderId: 'zhiyuan',
  FreeModelId: 'zhiyuan-free',
  ProductionBaseUrl: 'https://model.rongxzyai.com',
  DevelopmentBaseUrlEnvironmentVariable: 'ZHIYUAN_MODEL_POOL_BASE_URL',
  IntranetBaseUrl: 'http://172.18.5.188:3000',
  // Intranet gateway key, base64-encoded at rest per deployment convention.
  IntranetApiKeyBase64: 'c2stcEJ6MlFaZ3RVTktsNGE1ekJIMWM3cVk1dkhhdDhGV2owVDNHQ3FBZm1GMThDUkt0',
  // Model id served by the intranet gateway; cloud-side requests still use FreeModelId.
  IntranetModelId: 'GLM-5.3-Flash',
} as const;

export const ZhiyuanModelPoolHeader = {
  ConversationId: 'x-zhiyuan-conversation-id',
  Workload: 'x-zhiyuan-workload',
} as const;

export const ZhiyuanModelPoolWorkload = {
  Chat: 'chat',
  Work: 'work',
} as const;

export type ZhiyuanModelPoolWorkload =
  (typeof ZhiyuanModelPoolWorkload)[keyof typeof ZhiyuanModelPoolWorkload];

export const ZhiyuanModelPoolEvent = {
  AuthChanged: 'zhiyuan:model-pool-auth-changed',
} as const;

export const ModelPoolErrorCode = { SessionBusy: 'session_busy' } as const;
export const ModelPoolRetryPolicy = {
  MaximumRetries: 2,
  DefaultDelayMs: 2000,
  MaximumDelayMs: 3000,
  MaximumErrorBodyBytes: 16_384,
} as const;
