import { describe, expect, test } from 'vitest';

import { ApiFormat, ModelCapabilityStatus, ProviderModelDiscoveryErrorCode } from '../../shared/providers';
import {
  buildProviderModelsUrlCandidates,
  discoverProviderModels,
  parseProviderModelsResponse,
  ProviderModelDiscoveryError,
} from './providerModelDiscovery';

describe('buildProviderModelsUrlCandidates', () => {
  test('appends v1/models to a provider root', () => {
    expect(buildProviderModelsUrlCandidates('https://api.example.com/')).toEqual([
      'https://api.example.com/v1/models',
    ]);
  });

  test('uses models directly after a version segment', () => {
    expect(buildProviderModelsUrlCandidates('https://api.example.com/v1')).toEqual([
      'https://api.example.com/v1/models',
    ]);
    expect(buildProviderModelsUrlCandidates('https://api.example.com/v1beta')).toEqual([
      'https://api.example.com/v1beta/models',
      'https://api.example.com/v1beta/v1/models',
    ]);
  });

  test('adds root fallbacks for compatibility suffixes', () => {
    expect(buildProviderModelsUrlCandidates('https://api.example.com/api/anthropic')).toEqual([
      'https://api.example.com/api/anthropic/v1/models',
      'https://api.example.com/v1/models',
      'https://api.example.com/models',
    ]);
  });
});

describe('parseProviderModelsResponse', () => {
  test('normalizes, deduplicates, and sorts OpenAI-compatible models', () => {
    expect(
      parseProviderModelsResponse({
        data: [
          { id: ' model-b ', owned_by: 'team-b' },
          { id: 'model-a', name: 'Model A' },
          { id: 'model-a' },
          { id: '\u0000invalid' },
        ],
      }),
    ).toEqual([
      { id: 'model-a', displayName: 'Model A' },
      { id: 'model-b', ownedBy: 'team-b' },
    ]);
  });

  test('parses Gemini models and removes the models prefix', () => {
    expect(
      parseProviderModelsResponse({
        models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash' }],
      }),
    ).toEqual([{ id: 'gemini-3-flash', displayName: 'Gemini 3 Flash' }]);
  });

  test('reads explicit capacity and capability metadata without guessing missing fields', () => {
    expect(
      parseProviderModelsResponse({
        data: [
          {
            id: 'model-with-metadata',
            context_length: 32768,
            max_output_tokens: 4096,
            capabilities: {
              tool_calling: true,
              reasoning: 'supported',
            },
            modalities: ['text', 'image', 'audio'],
          },
        ],
      }),
    ).toEqual([
      {
        id: 'model-with-metadata',
        contextWindow: 32768,
        maxTokens: 4096,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Supported,
          imageInput: ModelCapabilityStatus.Supported,
          audioInput: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      },
    ]);
  });

  test('rejects unsupported payloads', () => {
    expect(() => parseProviderModelsResponse({ items: [] })).toThrowError(
      expect.objectContaining<Partial<ProviderModelDiscoveryError>>({
        code: ProviderModelDiscoveryErrorCode.UnsupportedFormat,
      }),
    );
  });
});

describe('discoverProviderModels', () => {
  test('falls back after a 404 and sends Anthropic authentication headers', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      if (requests.length === 1) return new Response('', { status: 404 });
      return Response.json({ data: [{ id: 'claude-test' }] });
    };

    await expect(
      discoverProviderModels(
        {
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'secret',
          apiFormat: ApiFormat.Anthropic,
        },
        fetchImpl,
      ),
    ).resolves.toEqual([{ id: 'claude-test' }]);
    expect(requests.map(request => request.url)).toEqual([
      'https://api.example.com/anthropic/v1/models',
      'https://api.example.com/v1/models',
    ]);
    expect(requests[0].headers.get('x-api-key')).toBe('secret');
    expect(requests[0].headers.get('anthropic-version')).toBe('2023-06-01');
    expect(requests[0].headers.get('authorization')).toBeNull();
  });

  test('uses the Gemini API key header', async () => {
    let headers = new Headers();
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ models: [] });
    };

    await discoverProviderModels(
      {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        apiFormat: ApiFormat.Gemini,
      },
      fetchImpl,
    );
    expect(headers.get('x-goog-api-key')).toBe('gemini-key');
  });
});
