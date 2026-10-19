import type { MagpieProviderApi } from '../../../../shared/magpie/types';

/**
 * Presets offered by the "Add Provider" dialog. Base URLs and model ids follow
 * each vendor's official API documentation (checked 2026-10-19). Presets never
 * carry credentials; users paste their own API key.
 */
export const PRESET_KEYS = [
  'custom',
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'moonshot',
  'qwen',
  'zhipu',
  'minimax',
  'minimaxPlan',
  'volcengine',
  'qianfan',
  'stepfun',
  'stepfunPlan',
  'xiaomi',
  'xiaomiTokenPlan',
  'grok',
  'openrouter',
  'ollama',
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

export interface PresetConfig {
  /** i18n key for the localized preset label shown in the dropdown. */
  labelKey: string;
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  defaultModels: string;
}

export const PRESETS: Record<PresetKey, PresetConfig> = {
  custom: {
    labelKey: 'magpiePresetCustom',
    name: '',
    api: 'openai-completions',
    baseUrl: '',
    defaultModels: '',
  },
  openai: {
    labelKey: 'magpiePresetOpenAI',
    name: 'OpenAI',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: 'gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna',
  },
  anthropic: {
    labelKey: 'magpiePresetAnthropic',
    name: 'Anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    defaultModels: 'claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5',
  },
  gemini: {
    labelKey: 'magpiePresetGemini',
    name: 'Google Gemini',
    api: 'openai-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: 'gemini-4-argon, gemini-3.8-flash',
  },
  deepseek: {
    labelKey: 'magpiePresetDeepSeek',
    name: 'DeepSeek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com',
    defaultModels: 'deepseek-flash, deepseek-v4-pro',
  },
  moonshot: {
    labelKey: 'magpiePresetMoonshot',
    name: 'Moonshot Kimi',
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModels: 'kimi-k3, kimi-k2.7-code, kimi-k2.6',
  },
  qwen: {
    labelKey: 'magpiePresetQwen',
    name: 'Qwen',
    api: 'openai-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModels: 'qwen3.8-max, qwen3.7-plus',
  },
  zhipu: {
    labelKey: 'magpiePresetZhipu',
    name: 'Zhipu GLM',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModels: 'glm-5.3, glm-5.2',
  },
  minimax: {
    labelKey: 'magpiePresetMiniMax',
    name: 'MiniMax',
    api: 'openai-completions',
    baseUrl: 'https://api.minimax.cn/v1',
    defaultModels: 'MiniMax-M3.1-Flash, MiniMax-M3',
  },
  // Subscription plan: same host as pay-as-you-go but needs the M Plan subscription key.
  minimaxPlan: {
    labelKey: 'magpiePresetMiniMaxPlan',
    name: 'MiniMax M Plan',
    api: 'openai-completions',
    baseUrl: 'https://api.minimax.cn/v1',
    defaultModels: 'MiniMax-M3.1-Flash-Preview',
  },
  volcengine: {
    labelKey: 'magpiePresetVolcengine',
    name: 'Volcengine Ark',
    api: 'openai-completions',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModels: 'doubao-seed-2-1-pro-260915, doubao-seed-2-1-lite-260915',
  },
  qianfan: {
    labelKey: 'magpiePresetQianfan',
    name: 'Baidu Qianfan',
    api: 'openai-completions',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModels: 'ernie-5.1, ernie-5.0',
  },
  stepfun: {
    labelKey: 'magpiePresetStepFun',
    name: 'StepFun',
    api: 'openai-completions',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModels: 'step-3.7-flash',
  },
  // Subscription plan endpoint; calls here draw on Step Plan credits, not account balance.
  stepfunPlan: {
    labelKey: 'magpiePresetStepFunPlan',
    name: 'StepFun Step Plan',
    api: 'openai-completions',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    defaultModels: 'step-5-preview, step-3.7-flash',
  },
  xiaomi: {
    labelKey: 'magpiePresetXiaomi',
    name: 'Xiaomi MiMo',
    api: 'openai-completions',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModels: 'mimo-v2.6-pro, mimo-v2.6-flash',
  },
  // Subscription plan endpoint; requires a tp-/ttp- Token Plan key (not the sk- API key).
  xiaomiTokenPlan: {
    labelKey: 'magpiePresetXiaomiTokenPlan',
    name: 'Xiaomi MiMo Token Plan',
    api: 'openai-completions',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    defaultModels: 'mimo-v2.6-pro',
  },
  grok: {
    labelKey: 'magpiePresetGrok',
    name: 'xAI Grok',
    api: 'openai-completions',
    baseUrl: 'https://api.x.ai/v1',
    defaultModels: 'grok-4.7',
  },
  openrouter: {
    labelKey: 'magpiePresetOpenRouter',
    name: 'OpenRouter',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: 'anthropic/claude-sonnet-5.5, openai/gpt-5.6-sol, google/gemini-4-argon',
  },
  ollama: {
    labelKey: 'magpiePresetOllama',
    name: 'Ollama',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModels: 'qwen2.5-coder:7b, llama3.3:latest',
  },
};
