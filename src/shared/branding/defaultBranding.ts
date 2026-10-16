import type { ProductBrandingConfig } from './types';

export const zhiyuanBranding: ProductBrandingConfig = {
  editionId: 'zhiyuan',
  productName: '知远智能体',
  shortName: '知远',
  englishName: 'ZhiYuan Agent',
  appId: 'zhiyuan',
  appUserModelId: 'com.zhiyuanagent.app',
  dataDirName: 'ZhiYuanAgent',
  dbFileName: 'zhiyuan.sqlite',
  defaultTheme: 'classic-light',
  promptIdentity: {
    chinese: '我是知远智能体。',
    english: 'I am ZhiYuan Agent.',
    instructions:
      'The official Chinese product name is 知远智能体, and the official English product name is ZhiYuan Agent. ' +
      '知远智能体 (ZhiYuan Agent) is a product of 北京容芯致远. ' +
      'Treat 知远智能体 and ZhiYuan Agent as the only official product names. ' +
      'When the user asks who you are, answer with the official product identity only.',
  },
  features: {
    enableCommunityAuth: true,
    enableCommunityFreeModels: true,
    enableOnlineUpdate: true,
    enableAISphere: false,
  },
};
