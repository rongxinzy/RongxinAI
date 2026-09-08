import { describe, expect, test } from 'vitest';

import { normalizeProviderModelPiRuntimeConfig } from './piRuntime';

describe('normalizeProviderModelPiRuntimeConfig', () => {
  test('preserves provider thinking level maps and removes invalid entries', () => {
    expect(
      normalizeProviderModelPiRuntimeConfig({
        api: 'openai-completions',
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          low: 'low',
          high: 'high',
          max: 'max',
          medium: '',
          unsupported: 'ignored',
        },
        compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
      }),
    ).toEqual({
      api: 'openai-completions',
      reasoning: true,
      thinkingLevelMap: { off: null, low: 'low', high: 'high', max: 'max' },
      compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
    });
  });
});
