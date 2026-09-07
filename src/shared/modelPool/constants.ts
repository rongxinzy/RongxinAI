export const ZhiyuanModelPool = {
  ProviderId: 'zhiyuan',
  FreeModelId: 'zhiyuan-free',
  ProductionBaseUrl: 'https://model.rongxzyai.com',
  DevelopmentBaseUrlEnvironmentVariable: 'ZHIYUAN_MODEL_POOL_BASE_URL',
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
