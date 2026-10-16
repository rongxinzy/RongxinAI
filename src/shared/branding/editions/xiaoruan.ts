import type { ProductBrandingConfig } from '../types';

export const xiaoruanBranding: ProductBrandingConfig = {
  editionId: 'xiaoruan',
  productName: '晓软AI智能体',
  shortName: '晓软',
  englishName: 'XiaoRuan AI Agent',
  appId: 'xiaoruan',
  appUserModelId: 'com.xiaoruan.app',
  dataDirName: 'XiaoRuanAIAgent',
  dbFileName: 'xiaoruan.sqlite',
  defaultTheme: 'xiaoruan-light',
  promptIdentity: {
    chinese: '我是晓软AI智能体。',
    english: 'I am XiaoRuan AI Agent.',
    instructions:
      'The official Chinese product name is 晓软AI智能体, and the official English product name is XiaoRuan AI Agent. ' +
      'Treat 晓软AI智能体 and XiaoRuan AI Agent as the official product names. ' +
      'When the user asks who you are, answer with the official product identity only.',
  },
  features: {
    enableCommunityAuth: false,
    // 免费模型为官方主品牌独占功能，定制版本不启用
    enableCommunityFreeModels: false,
    enableOnlineUpdate: false,
    enableAISphere: true,
  },
};
