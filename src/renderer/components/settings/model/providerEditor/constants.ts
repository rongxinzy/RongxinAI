export const ProviderModelView = { List: 'list', Text: 'text' } as const;
export const ProviderDiscoveryResolution = {
  Replace: 'replace',
  Append: 'append',
  Keep: 'keep',
} as const;
export const ProviderProtocol = {
  Chat: 'openai-completions',
  Messages: 'anthropic-messages',
  Responses: 'openai-responses',
} as const;
export const PROVIDER_MODEL_PAGE_SIZE = 10;
export const CUSTOM_PROVIDER_PRESET = 'custom';

export function parseProviderModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、\n]/)
        .map(value => value.trim())
        .filter(Boolean),
    ),
  ];
}
