import { describe, expect, test } from 'vitest';

import {
  applyProviderModelConnectionTestResults,
  createProviderConnectionTestSignature,
  isCurrentModelAvailableTest,
  ProviderModelConnectionFailureKind,
  ProviderModelConnectionTestStatus,
  type ProviderModelConnectionTest,
} from './connectionTest';

describe('provider connection test metadata', () => {
  test('changes the signature when the credential changes without exposing it', async () => {
    const provider = { apiKey: 'first-key' };
    const first = await createProviderConnectionTestSignature({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      provider,
    });
    const second = await createProviderConnectionTestSignature({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      provider: { ...provider, apiKey: 'second-key' },
    });

    expect(first).not.toBe(second);
    expect(first).not.toContain('first-key');
    expect(second).not.toContain('second-key');
  });

  test('stores success and failure results by model ID', () => {
    const provider = applyProviderModelConnectionTestResults<{
      models?: Array<{ id: string; connectionTest?: ProviderModelConnectionTest }>;
    }>(
      {
        models: [
          { id: 'failed-model' },
          { id: 'success-model' },
          { id: 'untested-model' },
        ],
      },
      [
        {
          modelId: 'failed-model',
          success: false,
          failureKind: ProviderModelConnectionFailureKind.Model,
        },
        { modelId: 'success-model', success: true },
      ],
      'signature',
      123,
    );

    expect(provider.models?.[0].connectionTest).toEqual({
      status: ProviderModelConnectionTestStatus.Failure,
      signature: 'signature',
      testedAt: 123,
      failureKind: ProviderModelConnectionFailureKind.Model,
    });
    expect(provider.models?.[1].connectionTest).toEqual({
      status: ProviderModelConnectionTestStatus.Success,
      signature: 'signature',
      testedAt: 123,
    });
    expect(provider.models?.[2].connectionTest).toBeUndefined();
  });

  test('treats only a current successful test as available', () => {
    const currentSuccess = {
      connectionTest: {
        status: ProviderModelConnectionTestStatus.Success,
        signature: 'signature',
        testedAt: 1,
      },
    };
    const staleSuccess = {
      connectionTest: {
        status: ProviderModelConnectionTestStatus.Success,
        signature: 'old-signature',
        testedAt: 1,
      },
    };
    const failure = {
      connectionTest: {
        status: ProviderModelConnectionTestStatus.Failure,
        signature: 'signature',
        testedAt: 1,
      },
    };

    expect(isCurrentModelAvailableTest(currentSuccess, 'signature')).toBe(true);
    expect(isCurrentModelAvailableTest(staleSuccess, 'signature')).toBe(false);
    expect(isCurrentModelAvailableTest(failure, 'signature')).toBe(false);
    expect(isCurrentModelAvailableTest({}, 'signature')).toBe(false);
  });
});