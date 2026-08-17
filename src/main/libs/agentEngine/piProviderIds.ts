import { ProviderName } from '../../../shared/providers';

export const PiBuiltinProviderId = {
  [ProviderName.OpenAI]: 'openai',
  [ProviderName.Anthropic]: 'anthropic',
  [ProviderName.Gemini]: 'google',
  [ProviderName.DeepSeek]: 'deepseek',
  [ProviderName.Moonshot]: 'moonshotai-cn',
  [ProviderName.Zhipu]: 'zai',
  [ProviderName.Minimax]: 'minimax-cn',
  [ProviderName.Xiaomi]: 'xiaomi',
  [ProviderName.OpenRouter]: 'openrouter',
  [ProviderName.Copilot]: 'github-copilot',
} as const;

export const PiCatalogProviderIdByApiKeyPrefix = {
  OPENAI: PiBuiltinProviderId[ProviderName.OpenAI],
  ANTHROPIC: PiBuiltinProviderId[ProviderName.Anthropic],
  GEMINI: PiBuiltinProviderId[ProviderName.Gemini],
  DEEPSEEK: PiBuiltinProviderId[ProviderName.DeepSeek],
  MOONSHOT: PiBuiltinProviderId[ProviderName.Moonshot],
  ZHIPU: PiBuiltinProviderId[ProviderName.Zhipu],
  MINIMAX: PiBuiltinProviderId[ProviderName.Minimax],
  XIAOMI: PiBuiltinProviderId[ProviderName.Xiaomi],
  OPENROUTER: PiBuiltinProviderId[ProviderName.OpenRouter],
  GITHUB_COPILOT: PiBuiltinProviderId[ProviderName.Copilot],
} as const;

export function resolvePiBuiltinProviderId(providerName?: string): string | null {
  if (!providerName) return null;
  return PiBuiltinProviderId[providerName as keyof typeof PiBuiltinProviderId] ?? null;
}
