import { zhiyuanBranding } from '../defaultBranding';
import type { ProductBrandingConfig } from '../types';

export const DEFENSE_EDITION_ID = 'defense';

export const defenseBranding: ProductBrandingConfig = {
  ...zhiyuanBranding,
  editionId: DEFENSE_EDITION_ID,
  productName: '知远智能体 国防版',
  englishName: 'ZhiYuan Agent Defense Edition',
  appId: 'zhiyuan-defense',
  appUserModelId: 'com.zhiyuanagent.defense',
  dataDirName: 'ZhiYuanAgentDefense',
  promptIdentity: {
    chinese: '我是知远智能体国防版。',
    english: 'I am ZhiYuan Agent Defense Edition.',
    instructions:
      'Use AISphere as the model platform. Answer questions about availability based on the current deployment.',
  },
  features: {
    enableCommunityAuth: false,
    enableCommunityFreeModels: false,
    enableOnlineUpdate: false,
    enableAISphere: true,
  },
};
