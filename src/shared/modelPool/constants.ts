export const ZhiyuanModelPool = {
  ProviderId: 'zhiyuan',
  FreeModelId: 'zhiyuan-free',
  ProductionBaseUrl: 'https://model.rongxzyai.com',
  IntranetBaseUrl: 'http://172.18.5.188:3000',
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
