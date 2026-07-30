import { describe, expect, test } from 'vitest';

import { ModelCapabilityStatus } from '../../shared/providers';
import {
  buildOpenRouterModelsUrl,
  parseLlamaCppModelCapabilities,
  parseOllamaModelCapabilities,
  parseOpenRouterModelCapabilities,
} from './modelCapabilityProbe';

describe('model capability metadata parsers', () => {
  test('reads tool and input capabilities from the matching OpenRouter model', () => {
    expect(
      parseOpenRouterModelCapabilities(
        {
          data: [
            {
              id: 'vendor/model',
              supported_parameters: ['tools', 'reasoning', 'temperature'],
              architecture: { input_modalities: ['text', 'image', 'file'] },
            },
          ],
        },
        'vendor/model',
      ),
    ).toEqual({
      toolCalling: ModelCapabilityStatus.Supported,
      imageInput: ModelCapabilityStatus.Supported,
      videoInput: ModelCapabilityStatus.Unsupported,
      audioInput: ModelCapabilityStatus.Unsupported,
      documentInput: ModelCapabilityStatus.Supported,
      reasoning: ModelCapabilityStatus.Supported,
    });
  });

  test('treats an explicit OpenRouter parameter list without tools as unsupported', () => {
    expect(
      parseOpenRouterModelCapabilities(
        {
          data: [
            {
              id: 'vendor/model',
              supported_parameters: ['temperature'],
            },
          ],
        },
        'vendor/model',
      ).toolCalling,
    ).toBe(ModelCapabilityStatus.Unsupported);
  });

  test('reads Ollama tools and vision declarations', () => {
    expect(
      parseOllamaModelCapabilities({ capabilities: ['completion', 'tools', 'vision'] }),
    ).toEqual({
      toolCalling: ModelCapabilityStatus.Supported,
      imageInput: ModelCapabilityStatus.Supported,
    });
    expect(parseOllamaModelCapabilities({ capabilities: ['completion'] })).toEqual({
      toolCalling: ModelCapabilityStatus.Unsupported,
      imageInput: ModelCapabilityStatus.Unsupported,
    });
  });

  test('uses llama.cpp template and modality declarations without guessing from model names', () => {
    expect(
      parseLlamaCppModelCapabilities({
        chat_template_caps: { supports_tools: true },
        modalities: { vision: false },
      }),
    ).toEqual({
      toolCalling: ModelCapabilityStatus.Supported,
      imageInput: ModelCapabilityStatus.Unsupported,
    });
    expect(
      parseLlamaCppModelCapabilities({
        chat_template_caps: { supports_tools: false },
      }).toolCalling,
    ).toBe(ModelCapabilityStatus.Unsupported);
    expect(parseLlamaCppModelCapabilities({ chat_template_caps: {} }).toolCalling).toBeUndefined();
  });

  test('normalizes OpenRouter Anthropic and OpenAI base URLs to the models endpoint', () => {
    expect(buildOpenRouterModelsUrl('https://openrouter.ai/api')).toBe(
      'https://openrouter.ai/api/v1/models',
    );
    expect(buildOpenRouterModelsUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/models',
    );
  });
});
