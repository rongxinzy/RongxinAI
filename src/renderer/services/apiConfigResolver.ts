import { resolveCodingPlanBaseUrl } from '../../shared/providers';
import { configService } from './config';

export interface ResolvedApiConfig {
  apiKey: string;
  baseUrl: string;
  provider: string;
  apiFormat: 'anthropic' | 'openai' | 'gemini';
}

export function normalizeApiFormat(apiFormat: unknown): 'anthropic' | 'openai' | 'gemini' {
  if (apiFormat === 'openai') return 'openai';
  if (apiFormat === 'gemini') return 'gemini';
  return 'anthropic';
}

export function buildOpenAICompatibleChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/chat/completions';
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

export function buildOpenAIResponsesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/responses';
  if (normalized.endsWith('/responses')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

export function shouldUseOpenAIResponsesApi(provider: string): boolean {
  return provider === 'openai';
}

export function providerRequiresApiKey(provider: string): boolean {
  return provider !== 'ollama' && provider !== 'github-copilot' && !provider.startsWith('custom_');
}

export function detectProvider(modelId: string, providerHint?: string): string {
  const normalizedHint = providerHint?.toLowerCase();
  if (
    normalizedHint &&
    ([
      'openai',
      'deepseek',
      'moonshot',
      'zhipu',
      'minimax',
      'qwen',
      'openrouter',
      'grok',
      'gemini',
      'anthropic',
      'xiaomi',
      'stepfun',
      'volcengine',
      'github-copilot',
      'ollama',
    ].includes(normalizedHint) ||
      normalizedHint.startsWith('custom_'))
  ) {
    return normalizedHint;
  }
  const normalizedModelId = modelId.toLowerCase();
  if (normalizedModelId.startsWith('claude')) return 'anthropic';
  if (
    normalizedModelId.startsWith('gpt') ||
    normalizedModelId.startsWith('o1') ||
    normalizedModelId.startsWith('o3') ||
    normalizedModelId.startsWith('o4')
  ) {
    return 'openai';
  }
  if (normalizedModelId.startsWith('gemini')) return 'gemini';
  if (normalizedModelId.startsWith('deepseek')) return 'deepseek';
  if (normalizedModelId.startsWith('kimi-')) return 'moonshot';
  if (normalizedModelId.startsWith('glm-')) return 'zhipu';
  if (normalizedModelId.startsWith('minimax')) return 'minimax';
  if (normalizedModelId.startsWith('qwen') || normalizedModelId.startsWith('qvq')) return 'qwen';
  if (normalizedModelId.startsWith('mimo') || normalizedModelId.includes('xiaomi')) return 'xiaomi';
  if (normalizedModelId.startsWith('step-')) return 'stepfun';
  if (
    normalizedModelId.startsWith('doubao') ||
    normalizedModelId.includes('volcengine') ||
    normalizedModelId.includes('ep-') ||
    normalizedModelId.startsWith('ark-')
  ) {
    return 'volcengine';
  }
  return 'openai';
}

export function getProviderConfig(provider: string): ResolvedApiConfig | null {
  const appConfig = configService.getConfig();
  if (appConfig?.providers?.[provider]) {
    const providerConfig = appConfig.providers[provider];
    if (providerConfig.enabled && (providerConfig.apiKey || !providerRequiresApiKey(provider))) {
      let baseUrl = providerConfig.baseUrl;
      let apiFormat = normalizeApiFormat(providerConfig.apiFormat);

      if (
        providerConfig.codingPlanEnabled &&
        (apiFormat === 'anthropic' || apiFormat === 'openai')
      ) {
        const resolved = resolveCodingPlanBaseUrl(provider, true, apiFormat, baseUrl);
        baseUrl = resolved.baseUrl;
        apiFormat = resolved.effectiveFormat;
      }

      return {
        apiKey: providerConfig.apiKey,
        baseUrl,
        provider,
        apiFormat,
      };
    }
  }
  return null;
}
