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

  test('normalizes pi 1.0 compat flags and drops invalid values', () => {
    expect(
      normalizeProviderModelPiRuntimeConfig({
        compat: {
          thinkingFormat: 'baseten',
          thinkingTokenBudgetField: 'thinking_budget_tokens',
          supportsThinkingTokenBudget: 'not-a-boolean',
          vllmPriority: 7,
          vllmPriorityDuplicate: 'dropped',
          supportsFinishReason: false,
          sessionAffinityFormat: 'openai-nosession',
          chatTemplateKwargs: { enable_thinking: '$thinking.enabled', empty: '' },
          unknownFlag: true,
        },
      }),
    ).toEqual({
      compat: {
        thinkingFormat: 'baseten',
        thinkingTokenBudgetField: 'thinking_budget_tokens',
        vllmPriority: 7,
        supportsFinishReason: false,
        sessionAffinityFormat: 'openai-nosession',
        chatTemplateKwargs: { enable_thinking: '$thinking.enabled' },
      },
    });
  });

  test('normalizes input limits and compaction budgets, dropping garbage', () => {
    expect(
      normalizeProviderModelPiRuntimeConfig({
        inputLimits: {
          maxRequestBytes: 'nope',
          images: {
            resize: { maxWidth: 1280, maxHeight: 960, maxBytes: 1_500_000 },
            maxPerMessage: 2,
            maxPerRequest: 4,
          },
        },
        compaction: { reserveTokens: 4096, keepRecentTokens: 'bad' },
        promptCache: { ttl: '30m' },
        samplingParams: { temperature: 0.2 },
      }),
    ).toEqual({
      inputLimits: {
        images: {
          resize: { maxWidth: 1280, maxHeight: 960, maxBytes: 1_500_000 },
          maxPerMessage: 2,
          maxPerRequest: 4,
        },
      },
      compaction: { reserveTokens: 4096 },
      promptCache: { ttl: '30m' },
      samplingParams: { temperature: 0.2 },
    });
  });
});
