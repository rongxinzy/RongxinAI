import type { MagpieProviderApi } from '../../../shared/magpie/types';

interface ProviderPresetPlanVariant {
  label: string;
  baseUrl: string;
  api?: MagpieProviderApi;
  defaultModels?: string;
}

export interface ConsolidatedProviderPreset {
  key: string;
  name: string;
  labelKey: string;
  shortDesc: string;
  api: MagpieProviderApi;
  baseUrl: string;
  defaultModels: string;
  requiresKey: boolean;
  popular?: boolean;
  docsUrl?: string;
  planVariant?: ProviderPresetPlanVariant;
}

export const CONSOLIDATED_PROVIDER_PRESETS: readonly ConsolidatedProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    labelKey: 'magpiePresetDeepSeek',
    shortDesc: 'DeepSeek-V3 / R1',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModels: 'deepseek-chat, deepseek-reasoner',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'qwen',
    name: '阿里云百炼（通义千问）',
    labelKey: 'magpiePresetQwen',
    shortDesc: 'Qwen3 / Qwen-Max',
    api: 'openai-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: 'qwen3.5-plus, qwen3.6-plus',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'zhipu',
    name: '智谱开放平台（GLM）',
    labelKey: 'magpiePresetZhipu',
    shortDesc: 'GLM-5 / GLM-4',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModels: 'glm-5.3, glm-5-air',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'openai',
    name: 'OpenAI',
    labelKey: 'magpiePresetOpenAI',
    shortDesc: 'GPT-5 / o3 / o4',
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: 'gpt-5.6, gpt-5.6-mini',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    labelKey: 'magpiePresetAnthropic',
    shortDesc: 'Claude Opus / Sonnet',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    defaultModels: 'claude-opus-5-5, claude-sonnet-5-5',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    labelKey: 'magpiePresetGemini',
    shortDesc: 'Gemini 4 Pro / Flash',
    api: 'openai-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: 'gemini-4-pro, gemini-4-argon',
    requiresKey: true,
    popular: true,
  },
  {
    key: 'moonshot',
    name: 'Moonshot AI（Kimi）',
    labelKey: 'magpiePresetMoonshot',
    shortDesc: 'Kimi K2.5 / 长上下文',
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModels: 'kimi-k2.5',
    requiresKey: true,
  },
  {
    key: 'minimax',
    name: 'MiniMax',
    labelKey: 'magpiePresetMiniMax',
    shortDesc: 'MiniMax M2.9',
    api: 'openai-completions',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModels: 'MiniMax-M2.9',
    requiresKey: true,
    planVariant: {
      label: 'MiniMax M Plan 套餐密钥',
      baseUrl: 'https://api.minimaxi.com/v1',
      defaultModels: 'MiniMax-M2.9',
    },
  },
  {
    key: 'volcengine',
    name: '火山方舟（豆包）',
    labelKey: 'magpiePresetVolcengine',
    shortDesc: 'Doubao Seed 2.0',
    api: 'openai-completions',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModels: 'doubao-seed-2.0-code',
    requiresKey: true,
  },
  {
    key: 'qianfan',
    name: '百度千帆（文心）',
    labelKey: 'magpiePresetQianfan',
    shortDesc: 'ERNIE 5',
    api: 'openai-completions',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModels: 'ernie-5-turbo-128k',
    requiresKey: true,
  },
  {
    key: 'stepfun',
    name: '阶跃星辰（StepFun）',
    labelKey: 'magpiePresetStepFun',
    shortDesc: 'Step-3',
    api: 'openai-completions',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModels: 'step-3',
    requiresKey: true,
    planVariant: {
      label: 'Step Plan 套餐密钥',
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      defaultModels: 'step-3',
    },
  },
  {
    key: 'xiaomi',
    name: '小米 MiMo',
    labelKey: 'magpiePresetXiaomi',
    shortDesc: 'MiMo V2.6 Pro',
    api: 'openai-completions',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModels: 'mimo-v2.6-pro',
    requiresKey: true,
    planVariant: {
      label: 'MiMo Token Plan 套餐密钥',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      defaultModels: 'mimo-v2.6-pro',
    },
  },
  {
    key: 'grok',
    name: 'xAI Grok',
    labelKey: 'magpiePresetGrok',
    shortDesc: 'Grok 4.7',
    api: 'openai-completions',
    baseUrl: 'https://api.x.ai/v1',
    defaultModels: 'grok-4.7',
    requiresKey: true,
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    labelKey: 'magpiePresetOpenRouter',
    shortDesc: '多模型聚合中转',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: 'anthropic/claude-sonnet-5.5, openai/gpt-5.6',
    requiresKey: true,
  },
  {
    key: 'custom',
    name: '自定义服务商',
    labelKey: 'providerWizardCustomCardTitle',
    shortDesc: '兼容 OpenAI / Anthropic 接口',
    api: 'openai-completions',
    baseUrl: '',
    defaultModels: '',
    requiresKey: false,
  },
];

export const POPULAR_PROVIDER_PRESETS = CONSOLIDATED_PROVIDER_PRESETS.filter(p => p.popular);
