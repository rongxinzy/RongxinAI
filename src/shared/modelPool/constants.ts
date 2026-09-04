export const ZhiyuanModelPool = {
  ProviderId: 'zhiyuan',
  FreeModelId: 'zhiyuan-free',
  ProductionBaseUrl: 'https://model.rongxzyai.com',
  DevelopmentBaseUrlEnvironmentVariable: 'ZHIYUAN_MODEL_POOL_BASE_URL',
} as const;

export const ZhiyuanModelPoolEvent = {
  AuthChanged: 'zhiyuan:model-pool-auth-changed',
} as const;
