import { describe, expect, test } from 'vitest';

import { AuthType, ProviderName } from '../../../shared/providers';
import { shouldAutoDetectProviderModels } from './providerModelAutoDetection';

const defaultInput = {
  providerId: ProviderName.DeepSeek,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  requiresApiKey: true,
};

describe('shouldAutoDetectProviderModels', () => {
  test('allows a provider with the required API key and base URL', () => {
    expect(shouldAutoDetectProviderModels(defaultInput)).toBe(true);
  });

  test('rejects a provider without a base URL', () => {
    expect(shouldAutoDetectProviderModels({ ...defaultInput, baseUrl: '  ' })).toBe(false);
  });

  test('rejects a provider missing a required API key', () => {
    expect(shouldAutoDetectProviderModels({ ...defaultInput, apiKey: '' })).toBe(false);
  });

  test('allows OAuth and optional API key providers without an API key', () => {
    expect(
      shouldAutoDetectProviderModels({ ...defaultInput, apiKey: '', authType: AuthType.OAuth }),
    ).toBe(true);
    expect(
      shouldAutoDetectProviderModels({ ...defaultInput, apiKey: '', requiresApiKey: false }),
    ).toBe(true);
  });

  test('rejects the local inference provider', () => {
    expect(
      shouldAutoDetectProviderModels({ ...defaultInput, providerId: ProviderName.LlamaCpp }),
    ).toBe(false);
  });
});
