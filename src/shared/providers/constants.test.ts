import { describe, expect, test } from 'vitest';

import { ApiFormat, ModelCapabilityStatus, ProviderName, ProviderRegistry } from './constants';

describe('ProviderName constants', () => {
  test('contains expected provider keys', () => {
    expect(ProviderName.OpenAI).toBe('openai');
    expect(ProviderName.DeepSeek).toBe('deepseek');
    expect(ProviderName.LlamaCpp).toBe('llamacpp');
    expect(ProviderName.Custom).toBe('custom');
    expect(ProviderName.ZhiyuanServer).toBe('zhiyuan-server');
  });
});

describe('ProviderRegistry', () => {
  test('providerIds returns 16 providers (no custom)', () => {
    const ids = ProviderRegistry.providerIds;
    expect(ids.length).toBe(16);
    expect(ids).not.toContain(ProviderName.Custom);
    expect(ids).not.toContain(ProviderName.ZhiyuanServer);
  });

  test('get returns definition for known provider', () => {
    const def = ProviderRegistry.get(ProviderName.OpenAI);
    expect(def).toBeDefined();
    expect(def!.id).toBe(ProviderName.OpenAI);
    expect(def!.defaultApiFormat).toBe(ApiFormat.OpenAI);
    expect(def!.region).toBe('global');
  });

  test('stores verified cloud model capacity metadata', () => {
    const expectations = [
      [ProviderName.DeepSeek, 'deepseek-v4-flash', 1_000_000, 384_000],
      [ProviderName.Moonshot, 'kimi-k3', 1_048_576, 131_072],
      [ProviderName.Qwen, 'qwen3.7-plus', 1_000_000, 64_000],
      [ProviderName.Zhipu, 'glm-5.2', 1_000_000, 131_072],
      [ProviderName.Minimax, 'MiniMax-M3', 1_000_000, 128_000],
      [ProviderName.StepFun, 'step-3.7-flash', 256_000, 256_000],
      [ProviderName.Xiaomi, 'mimo-v2.5-pro', 1_048_576, 131_072],
      [ProviderName.OpenAI, 'gpt-5.4', 1_050_000, 128_000],
      [ProviderName.Gemini, 'gemini-3-pro-preview', 1_048_576, 65_536],
      [ProviderName.Anthropic, 'claude-opus-4-6', 1_000_000, 128_000],
      [ProviderName.OpenRouter, 'openai/gpt-5.2-codex', 400_000, 128_000],
    ] as const;

    for (const [providerName, modelId, contextWindow, maxTokens] of expectations) {
      const model = ProviderRegistry.get(providerName)?.defaultModels.find(
        candidate => candidate.id === modelId,
      );
      expect(model).toMatchObject({ contextWindow, maxTokens });
    }
  });

  test('registers complete capability metadata and gates tools by endpoint', () => {
    for (const provider of ProviderRegistry.providerIds) {
      const def = ProviderRegistry.get(provider)!;
      for (const model of [...def.defaultModels, ...(def.codingPlanModels ?? [])]) {
        const capabilities = ProviderRegistry.resolveModelCapabilities(
          provider,
          model.id,
          def.defaultApiFormat,
          model,
        );
        expect(capabilities.imageInput).toBe(
          model.supportsImage ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported,
        );
        expect(capabilities).toHaveProperty('toolCalling');
        expect(capabilities).toHaveProperty('videoInput');
        expect(capabilities).toHaveProperty('audioInput');
        expect(capabilities).toHaveProperty('documentInput');
        expect(capabilities).toHaveProperty('reasoning');
      }
    }
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Moonshot,
        'kimi-k3',
        ApiFormat.Anthropic,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unsupported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.OpenRouter,
        'unknown',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unknown);
    for (const provider of [ProviderName.Zhipu, ProviderName.Volcengine]) {
      expect(
        ProviderRegistry.resolveModelCapabilities(
          provider,
          ProviderRegistry.get(provider)!.defaultModels[0].id,
          ApiFormat.Anthropic,
        ).toolCalling,
      ).toBe(ModelCapabilityStatus.Supported);
    }
  });

  test('get returns undefined for unknown provider', () => {
    expect(ProviderRegistry.get('nonexistent')).toBeUndefined();
    expect(ProviderRegistry.get(ProviderName.Custom)).toBeUndefined();
  });

  test('resolveModelSupportsImage repairs known provider model metadata', () => {
    expect(
      ProviderRegistry.resolveModelSupportsImage(ProviderName.Qwen, 'qwen3.6-plus', false),
    ).toBe(true);
    expect(
      ProviderRegistry.resolveModelSupportsImage(ProviderName.Qwen, 'qwen3-coder-plus', true),
    ).toBe(false);
  });

  test('resolveModelSupportsImage honors explicit custom-provider image settings', () => {
    expect(ProviderRegistry.resolveModelSupportsImage('custom_0', 'qwen3.6-plus', false)).toBe(
      false,
    );
    expect(ProviderRegistry.resolveModelSupportsImage('custom_0', 'qwen3-coder-plus', true)).toBe(
      true,
    );
    expect(ProviderRegistry.resolveModelSupportsImage('custom_0', 'unknown-model', false)).toBe(
      false,
    );
    expect(ProviderRegistry.resolveModelSupportsImage('custom_0', 'unknown-model', true)).toBe(
      true,
    );
  });

  test('supportsCodingPlan is true for moonshot, qwen, zhipu, volcengine, qianfan, xiaomi', () => {
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Moonshot)).toBe(true);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Qwen)).toBe(true);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Zhipu)).toBe(true);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Volcengine)).toBe(true);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Qianfan)).toBe(true);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.Xiaomi)).toBe(true);
  });

  test('keeps each coding-plan model catalog assigned to its provider', () => {
    const expectedModelIds = new Map([
      [ProviderName.Moonshot, ['kimi-for-coding']],
      [ProviderName.Qwen, ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus']],
      [ProviderName.Zhipu, ['glm-5.2', 'glm-5-turbo', 'glm-4.7']],
      [ProviderName.Volcengine, ['ark-code-latest']],
      [ProviderName.Qianfan, ['qianfan-code-latest', 'glm-5.1', 'deepseek-v4-flash']],
      [ProviderName.Xiaomi, ['mimo-v2.5-pro', 'mimo-v2.5']],
    ]);

    for (const [provider, modelIds] of expectedModelIds) {
      expect(ProviderRegistry.get(provider)?.codingPlanModels?.map(model => model.id)).toEqual(
        modelIds,
      );
    }
    expect(ProviderRegistry.get(ProviderName.Minimax)?.codingPlanModels).toBeUndefined();
  });

  test('supportsCodingPlan is false for others', () => {
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.OpenAI)).toBe(false);
    expect(ProviderRegistry.supportsCodingPlan(ProviderName.DeepSeek)).toBe(false);
    expect(ProviderRegistry.supportsCodingPlan('unknown')).toBe(false);
  });

  test('idsByRegion china returns 11 providers', () => {
    const china = ProviderRegistry.idsByRegion('china');
    expect(china.length).toBe(11);
    expect(china).toContain(ProviderName.DeepSeek);
    expect(china).toContain(ProviderName.Qianfan);
    expect(china).toContain(ProviderName.LlamaCpp);
    expect(china).toContain(ProviderName.Ollama);
    expect(china).not.toContain(ProviderName.OpenAI);
  });

  test('idsByRegion global returns 5 providers', () => {
    const global = ProviderRegistry.idsByRegion('global');
    expect(global.length).toBe(5);
    expect(global).toContain(ProviderName.OpenAI);
    expect(global).toContain(ProviderName.Gemini);
    expect(global).toContain(ProviderName.Anthropic);
    expect(global).toContain(ProviderName.OpenRouter);
    expect(global).toContain(ProviderName.Copilot);
  });

  test('idsForEnLocale starts with EN_PRIORITY providers in order', () => {
    const en = ProviderRegistry.idsForEnLocale();
    expect(en[0]).toBe(ProviderName.OpenAI);
    expect(en[1]).toBe(ProviderName.Anthropic);
    expect(en[2]).toBe(ProviderName.Gemini);
  });

  test('idsForEnLocale puts local providers at end', () => {
    const en = ProviderRegistry.idsForEnLocale();
    expect(en[en.length - 2]).toBe(ProviderName.LlamaCpp);
    expect(en[en.length - 1]).toBe(ProviderName.Ollama);
    expect(en).not.toContain(ProviderName.Custom);
  });

  test('idsForEnLocale has no duplicates', () => {
    const en = ProviderRegistry.idsForEnLocale();
    expect(new Set(en).size).toBe(en.length);
  });

  test('every definition has non-empty defaultBaseUrl', () => {
    for (const id of ProviderRegistry.providerIds) {
      const def = ProviderRegistry.get(id)!;
      expect(def.defaultBaseUrl.length).toBeGreaterThan(0);
    }
  });

  test('every definition has valid ApiFormat', () => {
    const validFormats = new Set([ApiFormat.OpenAI, ApiFormat.Anthropic, ApiFormat.Gemini]);
    for (const id of ProviderRegistry.providerIds) {
      const def = ProviderRegistry.get(id)!;
      expect(validFormats.has(def.defaultApiFormat)).toBe(true);
    }
  });

  describe('getCodingPlanUrl', () => {
    test('returns anthropic endpoint for coding-plan-supported providers', () => {
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Moonshot, 'anthropic')).toBe(
        'https://api.kimi.com/coding',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Qwen, 'anthropic')).toBe(
        'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Zhipu, 'anthropic')).toBe(
        'https://open.bigmodel.cn/api/anthropic',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Volcengine, 'anthropic')).toBe(
        'https://ark.cn-beijing.volces.com/api/coding',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Xiaomi, 'anthropic')).toBe(
        'https://token-plan-cn.xiaomimimo.com/anthropic',
      );
    });

    test('returns openai endpoint for coding-plan-supported providers', () => {
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Moonshot, 'openai')).toBe(
        'https://api.kimi.com/coding/v1',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Qwen, 'openai')).toBe(
        'https://coding.dashscope.aliyuncs.com/v1',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Zhipu, 'openai')).toBe(
        'https://open.bigmodel.cn/api/coding/paas/v4',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Volcengine, 'openai')).toBe(
        'https://ark.cn-beijing.volces.com/api/coding/v3',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Qianfan, 'openai')).toBe(
        'https://qianfan.baidubce.com/v2/coding/chat/completions',
      );
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.Xiaomi, 'openai')).toBe(
        'https://token-plan-cn.xiaomimimo.com/v1',
      );
    });

    test('returns undefined for providers that do not support codingPlan', () => {
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.OpenAI, 'openai')).toBeUndefined();
      expect(ProviderRegistry.getCodingPlanUrl(ProviderName.DeepSeek, 'anthropic')).toBeUndefined();
      expect(ProviderRegistry.getCodingPlanUrl('unknown', 'anthropic')).toBeUndefined();
    });
  });

  describe('getSwitchableBaseUrl', () => {
    test('returns anthropic url for providers with switchableBaseUrls', () => {
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.DeepSeek, 'anthropic')).toBe(
        'https://api.deepseek.com/anthropic',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Moonshot, 'anthropic')).toBe(
        'https://api.moonshot.cn/anthropic',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Zhipu, 'anthropic')).toBe(
        'https://open.bigmodel.cn/api/anthropic',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Minimax, 'anthropic')).toBe(
        'https://api.minimaxi.com/anthropic',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Qwen, 'anthropic')).toBe(
        'https://dashscope.aliyuncs.com/apps/anthropic',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Ollama, 'anthropic')).toBe(
        'http://localhost:11434',
      );
    });

    test('returns openai url for providers with switchableBaseUrls', () => {
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.DeepSeek, 'openai')).toBe(
        'https://api.deepseek.com',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Moonshot, 'openai')).toBe(
        'https://api.moonshot.cn/v1',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Zhipu, 'openai')).toBe(
        'https://open.bigmodel.cn/api/paas/v4',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Minimax, 'openai')).toBe(
        'https://api.minimaxi.com/v1',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Qwen, 'openai')).toBe(
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      );
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Ollama, 'openai')).toBe(
        'http://localhost:11434/v1',
      );
    });

    test('returns undefined for providers without switchableBaseUrls', () => {
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.OpenAI, 'openai')).toBeUndefined();
      expect(
        ProviderRegistry.getSwitchableBaseUrl(ProviderName.Anthropic, 'anthropic'),
      ).toBeUndefined();
      expect(ProviderRegistry.getSwitchableBaseUrl(ProviderName.Gemini, 'openai')).toBeUndefined();
      expect(ProviderRegistry.getSwitchableBaseUrl('unknown', 'anthropic')).toBeUndefined();
    });
  });
});
