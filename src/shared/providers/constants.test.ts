import { describe, expect, test } from 'vitest';

import {
  AgentProviderId,
  ApiFormat,
  ModelCapabilityStatus,
  ProviderName,
  ProviderRegistry,
} from './constants';

describe('ProviderName constants', () => {
  test('contains expected provider keys', () => {
    expect(ProviderName.OpenAI).toBe('openai');
    expect(ProviderName.DeepSeek).toBe('deepseek');
    expect(ProviderName.LlamaCpp).toBe('llamacpp');
    expect(ProviderName.Custom).toBe('custom');
  });
});

describe('ProviderRegistry', () => {
  test('providerIds returns 18 providers (no custom or legacy server)', () => {
    const ids = ProviderRegistry.providerIds;
    expect(ids.length).toBe(18);
    expect(ids).toContain(ProviderName.Zhiyuan);
    expect(ids).not.toContain(ProviderName.Custom);
    expect(ids).not.toContain('zhiyuan-server');
  });

  test('get returns definition for known provider', () => {
    const def = ProviderRegistry.get(ProviderName.OpenAI);
    expect(def).toBeDefined();
    expect(def!.id).toBe(ProviderName.OpenAI);
    expect(def!.defaultApiFormat).toBe(ApiFormat.OpenAI);
    expect(def!.region).toBe('global');
  });

  test('resolves runtime provider IDs back to configuration keys', () => {
    expect(ProviderRegistry.getProviderNameByAgentProviderId(AgentProviderId.Zai)).toBe(
      ProviderName.Zhipu,
    );
    expect(ProviderRegistry.getProviderNameByAgentProviderId(AgentProviderId.Google)).toBe(
      ProviderName.Gemini,
    );
    expect(ProviderRegistry.getProviderNameByAgentProviderId('unknown')).toBeUndefined();
  });

  test('stores official model capacity metadata', () => {
    const expectations = [
      [ProviderName.DeepSeek, 'deepseek-v4-flash', 1_000_000, 384_000],
      [ProviderName.Moonshot, 'kimi-k3', 1_000_000, 131_072],
      [ProviderName.Qwen, 'qwen3.7-plus', 1_000_000, 64_000],
      [ProviderName.Zhipu, 'glm-5.2', 1_000_000, 131_072],
      [ProviderName.Volcengine, 'doubao-seed-2-0-lite-260215', 256_000, 128_000],
      [ProviderName.Xiaomi, 'mimo-v2.5-pro', 1_000_000, 128_000],
      [ProviderName.OpenAI, 'gpt-5.4', 1_050_000, 128_000],
      [ProviderName.OpenAI, 'gpt-5.6-sol', 1_050_000, 128_000],
      [ProviderName.OpenAI, 'gpt-5.6-terra', 1_050_000, 128_000],
      [ProviderName.OpenAI, 'gpt-5.6-luna', 1_050_000, 128_000],
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

  test('registers GPT-5.6 model IDs and the official Sol alias', () => {
    expect(ProviderRegistry.getModel(ProviderName.OpenAI, 'gpt-5.6')?.id).toBe('gpt-5.6-sol');
    for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(
        ProviderRegistry.resolveModelCapabilities(ProviderName.OpenAI, modelId, ApiFormat.OpenAI),
      ).toMatchObject({
        toolCalling: ModelCapabilityStatus.Supported,
        imageInput: ModelCapabilityStatus.Supported,
        reasoning: ModelCapabilityStatus.Supported,
      });
    }
  });

  test('does not invent a fixed output limit when the official API does not publish one', () => {
    expect(ProviderRegistry.getModel(ProviderName.Minimax, 'MiniMax-M3')).toMatchObject({
      contextWindow: 1_000_000,
    });
    expect(
      ProviderRegistry.getModel(ProviderName.Minimax, 'MiniMax-M3')?.maxTokens,
    ).toBeUndefined();
    expect(ProviderRegistry.getModel(ProviderName.StepFun, 'step-3.7-flash')).toMatchObject({
      contextWindow: 256_000,
    });
    expect(
      ProviderRegistry.getModel(ProviderName.StepFun, 'step-3.7-flash')?.maxTokens,
    ).toBeUndefined();
    expect(ProviderRegistry.getModel(ProviderName.Moonshot, 'kimi-k2.6')).toMatchObject({
      contextWindow: 256_000,
    });
    expect(
      ProviderRegistry.getModel(ProviderName.Moonshot, 'kimi-k2.6')?.maxTokens,
    ).toBeUndefined();
  });

  test('stores coding-plan capacity for Kimi for Coding', () => {
    expect(ProviderRegistry.getModel(ProviderName.Moonshot, 'kimi-for-coding')).toMatchObject({
      contextWindow: 262_144,
      maxTokens: 32_768,
    });
  });

  test('returns no matches for an undefined model ID', () => {
    expect(ProviderRegistry.findModelsById(undefined)).toEqual([]);
  });

  test('registers complete capability metadata and gates catalog tools by endpoint', () => {
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
    // The Kimi for Coding plan endpoints support tool calling in both formats,
    // even though the general Moonshot /anthropic endpoint does not.
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Moonshot,
        'kimi-for-coding',
        ApiFormat.Anthropic,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    expect(
      ProviderRegistry.resolveModelCapabilities(ProviderName.Moonshot, 'kimi-k3', ApiFormat.OpenAI)
        .toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Moonshot,
        'kimi-for-coding',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.OpenRouter,
        'unknown',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unknown);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.OpenAI,
        'unregistered-openai-compatible-model',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    // An explicit configured "unsupported" is user intent and still wins.
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.OpenAI,
        'unregistered-openai-compatible-model',
        ApiFormat.OpenAI,
        {
          capabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
        },
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unsupported);
    // A configured "unknown" is the default residue of the capability form,
    // not a verdict: it must not short-circuit the endpoint declaration.
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-v4-flash-vision-exp',
        ApiFormat.OpenAI,
        {
          supportsImage: true,
          capabilities: {
            toolCalling: ModelCapabilityStatus.Unknown,
            imageInput: ModelCapabilityStatus.Unknown,
          },
        },
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    // Same residue rule for imageInput: the image toggle (supportsImage)
    // must take effect despite the configured unknown residue, so the
    // renderer store resolves the model as vision-capable.
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-v4-flash-vision-exp',
        ApiFormat.OpenAI,
        {
          supportsImage: true,
          capabilities: {
            imageInput: ModelCapabilityStatus.Unknown,
          },
        },
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Supported);
    // Without the toggle, the unstated imageInput stays conservatively
    // Unknown. Settings always writes a supportsImage boolean (Unknown
    // derives to false), so the real stored shape must not degrade an
    // unstated capability into an explicit "unsupported".
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-v4-flash-vision-exp',
        ApiFormat.OpenAI,
        {
          supportsImage: false,
          capabilities: {
            imageInput: ModelCapabilityStatus.Unknown,
          },
        },
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Unknown);
    // An explicit configured unsupported imageInput still wins.
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-v4-flash-vision-exp',
        ApiFormat.OpenAI,
        {
          supportsImage: true,
          capabilities: {
            imageInput: ModelCapabilityStatus.Unsupported,
          },
        },
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Unsupported);
    // Catalog declarations stay authoritative against a stale configured
    // toggle: a non-vision catalog model must not be upgraded to
    // Supported by an old supportsImage: true (deepseek-reasoner and
    // qwen3-coder-plus are explicitly non-vision in the catalog).
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-reasoner',
        ApiFormat.OpenAI,
        { supportsImage: true },
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Unsupported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Qwen,
        'qwen3-coder-plus',
        ApiFormat.OpenAI,
        { supportsImage: true },
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Unsupported);
    // Providers without an endpoint tool declaration keep failing closed
    // (llamacpp/Ollama/custom rely on runtime probing instead).
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.LlamaCpp,
        'unlisted-local-model',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unknown);
    for (const provider of [ProviderName.Zhipu, ProviderName.Volcengine]) {
      const capability = ProviderRegistry.resolveModelCapabilities(
        provider,
        ProviderRegistry.get(provider)!.defaultModels[0].id,
        ApiFormat.Anthropic,
      ).toolCalling;
      expect(capability).toBe(ModelCapabilityStatus.Supported);
    }
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Qianfan,
        'deepseek-v3.2',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.Qianfan,
        'ernie-4.5-8k',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unknown);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.StepFun,
        'step-3.7-flash',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Supported);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.DeepSeek,
        'deepseek-reasoner',
        ApiFormat.OpenAI,
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unknown);
    expect(
      ProviderRegistry.resolveModelCapabilities(
        ProviderName.OpenRouter,
        'unlisted-model',
        ApiFormat.OpenAI,
      ).imageInput,
    ).toBe(ModelCapabilityStatus.Unknown);
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

  test('does not infer image support from the same bare model id on another provider', () => {
    expect(ProviderRegistry.resolveModelSupportsImage(ProviderName.OpenAI, 'qwen3.6-plus')).toBe(
      false,
    );
    expect(
      ProviderRegistry.resolveModelSupportsImage(ProviderName.OpenAI, 'qwen3.6-plus', false),
    ).toBe(false);
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

  test('idsByRegion china returns 12 providers', () => {
    const china = ProviderRegistry.idsByRegion('china');
    expect(china.length).toBe(12);
    expect(china).toContain(ProviderName.Zhiyuan);
    expect(china).toContain(ProviderName.DeepSeek);
    expect(china).toContain(ProviderName.Qianfan);
    expect(china).toContain(ProviderName.LlamaCpp);
    expect(china).toContain(ProviderName.Ollama);
    expect(china).not.toContain(ProviderName.OpenAI);
  });

  test('idsByRegion global returns 6 providers', () => {
    const global = ProviderRegistry.idsByRegion('global');
    expect(global.length).toBe(6);
    expect(global).toContain(ProviderName.OpenAI);
    expect(global).toContain(ProviderName.Gemini);
    expect(global).toContain(ProviderName.Anthropic);
    expect(global).toContain(ProviderName.OpenRouter);
    expect(global).toContain(ProviderName.Grok);
    expect(global).toContain(ProviderName.Copilot);
  });

  test('resolves catalog models by provider and model ID', () => {
    expect(ProviderRegistry.getModel(ProviderName.Grok, 'grok-4.5')).toMatchObject({
      id: 'grok-4.5',
      contextWindow: 500_000,
      capabilities: {
        toolCalling: ModelCapabilityStatus.Supported,
        reasoning: ModelCapabilityStatus.Supported,
      },
    });
    expect(ProviderRegistry.getModel(ProviderName.OpenAI, 'grok-4.5')).toBeUndefined();
    expect(ProviderRegistry.findModelsById('gpt-5.4').map(match => match.providerId)).toContain(
      ProviderName.OpenAI,
    );
    expect(ProviderRegistry.findModelsById('not-in-catalog')).toEqual([]);
  });

  test('normalizes catalog lookups without changing the canonical model ID', () => {
    expect(ProviderRegistry.getModel(ProviderName.Grok, '  GROK-4.5 ')).toMatchObject({
      id: 'grok-4.5',
    });
    expect(ProviderRegistry.findModelsById(' GPT-5.4 ').map(match => match.providerId)).toContain(
      ProviderName.OpenAI,
    );
    expect(
      ProviderRegistry.resolveModelCapabilities(ProviderName.OpenAI, ' GPT-5.4 ', ApiFormat.OpenAI)
        .reasoning,
    ).toBe(ModelCapabilityStatus.Supported);
  });

  test('keeps duplicate default and coding-plan entries addressable', () => {
    const models = ProviderRegistry.getModels(ProviderName.Qwen, 'qwen3.7-plus');
    expect(models).toHaveLength(2);
    expect(models.every(model => model.id === 'qwen3.7-plus')).toBe(true);
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
