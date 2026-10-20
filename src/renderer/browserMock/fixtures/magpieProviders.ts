import type { MagpieProviderSummary } from '../../../shared/magpie/types';

export const mockMagpieProviders: MagpieProviderSummary[] = [
  {
    id: 'preview-openai',
    name: 'Preview OpenAI',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    off: false,
    isHostManaged: false,
    hasKey: true,
    keyMasked: 'sk-…preview',
    fallback: [],
  },
  {
    id: 'zhiyuan-host-gpu',
    name: 'Local GPU',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:8080/v1',
    models: ['preview-model'],
    off: false,
    isHostManaged: true,
    hasKey: false,
    keyMasked: 'system-managed',
    fallback: [],
  },
];
