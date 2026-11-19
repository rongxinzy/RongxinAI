import { describe, expect, it } from 'vitest';

import type { MagpieModel, MagpieProviderSummary } from '../../../shared/magpie/types';
import { resolveMagpieFallbackMaxTokens, resolveMagpieModelCompat } from './piMagpieModelCompat';

const provider = (id: string, baseUrl: string, models: string[] = []): MagpieProviderSummary => ({
  id,
  name: id,
  api: 'openai-completions',
  baseUrl,
  models,
  off: false,
  hasKey: true,
});

const model = (id: string, patch: Partial<MagpieModel> = {}): MagpieModel => ({
  id,
  ...patch,
});

describe('resolveMagpieModelCompat', () => {
  it('restores DeepSeek reasoning content continuity and thinking format', () => {
    expect(
      resolveMagpieModelCompat(
        model('custom-ds/deepseek-reasoner', { reasoning: true }),
        'openai-completions',
        provider('custom-ds', 'https://api.deepseek.com/v1', ['deepseek-reasoner']),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: 'deepseek',
    });
  });

  it('restores Zhipu GLM zai thinking format and conditional reasoning_effort', () => {
    expect(
      resolveMagpieModelCompat(
        model('zhipu/glm-4.5', {
          reasoning: true,
          supported_reasoning_levels: [{ effort: 'high' }],
        }),
        'openai-completions',
        provider('zhipu', 'https://open.bigmodel.cn/api/paas/v4', ['glm-4.5']),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'zai',
    });

    expect(
      resolveMagpieModelCompat(
        model('zhipu/glm-5.3-flash', { reasoning: true }),
        'openai-completions',
      ).supportsReasoningEffort,
    ).toBe(false);
  });

  it('restores Moonshot / Kimi compat', () => {
    expect(
      resolveMagpieModelCompat(
        model('moonshot/kimi-k2.5', {
          reasoning: true,
          supported_reasoning_levels: [{ effort: 'medium' }],
        }),
        'openai-completions',
        provider('moonshot', 'https://api.moonshot.cn/v1', ['kimi-k2.5']),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
    });
  });

  it('restores xAI / Grok compat', () => {
    expect(
      resolveMagpieModelCompat(
        model('xai/grok-3'),
        'openai-completions',
        provider('xai', 'https://api.x.ai/v1', ['grok-3']),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  });

  it('restores OpenRouter compat for Anthropic and non-Anthropic models', () => {
    expect(
      resolveMagpieModelCompat(
        model('openrouter/anthropic/claude-sonnet-4'),
        'openai-completions',
        provider('openrouter', 'https://openrouter.ai/api/v1'),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      thinkingFormat: 'openrouter',
      sessionAffinityFormat: 'openrouter',
      supportsDeveloperRole: true,
      cacheControlFormat: 'anthropic',
    });

    expect(
      resolveMagpieModelCompat(
        model('openrouter/google/gemini-2.5-pro'),
        'openai-completions',
        provider('openrouter', 'https://openrouter.ai/api/v1'),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      thinkingFormat: 'openrouter',
      sessionAffinityFormat: 'openrouter',
      supportsDeveloperRole: false,
    });
  });

  it('keeps official OpenAI compat for api.openai.com while isolating generic/Qwen/LAN servers', () => {
    expect(
      resolveMagpieModelCompat(
        model('custom-openai/gpt-5.4', { reasoning: true }),
        'openai-completions',
        provider('custom-openai', 'https://api.openai.com/v1', ['gpt-5.4']),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: true,
      supportsDeveloperRole: true,
      maxTokensField: 'max_completion_tokens',
    });

    expect(
      resolveMagpieModelCompat(
        model('dashscope/qwen3-coder'),
        'openai-completions',
        provider('dashscope', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
    });

    expect(
      resolveMagpieModelCompat(
        model('lan/local-model'),
        'openai-completions',
        provider('lan', 'http://192.168.1.50:8000/v1'),
      ),
    ).toEqual({
      sendSessionAffinityHeaders: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
    });
  });

  it('keeps minimal session-affinity compat for anthropic-messages and openai-responses', () => {
    expect(
      resolveMagpieModelCompat(model('anthropic/claude-opus-4'), 'anthropic-messages'),
    ).toEqual({
      sendSessionAffinityHeaders: true,
    });
    expect(resolveMagpieModelCompat(model('openai/gpt-5.4'), 'openai-responses')).toEqual({
      sendSessionAffinityHeaders: true,
    });
  });
});

describe('resolveMagpieFallbackMaxTokens', () => {
  it('prefers explicit max_output_tokens clamped to contextWindow', () => {
    expect(
      resolveMagpieFallbackMaxTokens(model('a', { max_output_tokens: 4096 }), 32768, 8192),
    ).toBe(4096);
    expect(
      resolveMagpieFallbackMaxTokens(model('a', { max_output_tokens: 65536 }), 32768, 8192),
    ).toBe(32768);
  });

  it('scales default output ceiling by contextWindow and reasoning capability', () => {
    expect(resolveMagpieFallbackMaxTokens(model('a', { reasoning: false }), 32768, 8192)).toBe(
      8192,
    );
    expect(resolveMagpieFallbackMaxTokens(model('a', { reasoning: true }), 32768, 8192)).toBe(
      16384,
    );
    expect(resolveMagpieFallbackMaxTokens(model('a', { reasoning: false }), 131072, 8192)).toBe(
      16384,
    );
    expect(resolveMagpieFallbackMaxTokens(model('a', { reasoning: true }), 262144, 8192)).toBe(
      32768,
    );
    expect(resolveMagpieFallbackMaxTokens(model('a', { reasoning: true }), 16384, 8192)).toBe(8192);
  });
});
