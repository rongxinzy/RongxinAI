import { describe, expect, test } from 'vitest';
import {
  appendV1ToBaseUrl,
  classifyProviderError,
  maskSecretsInError,
} from './providerErrorClassifier';

describe('providerErrorClassifier', () => {
  test('classifies 401 and requiresKey as auth_invalid and masks secrets', () => {
    const result = classifyProviderError({
      testResult: { ok: false, requiresKey: true, error: 'HTTP 401 Bearer sk-secret123456789' },
      providerName: 'DeepSeek',
    });
    expect(result.code).toBe('auth_invalid');
    expect(result.action).toBe('reenter_key');
    expect(result.technicalDetail).not.toContain('sk-secret123456789');
  });

  test('suggests /v1 fix for html endpoints without a version suffix', () => {
    const result = classifyProviderError({
      testResult: { ok: false, errorCode: 'html-endpoint', error: 'text/html' },
      baseUrl: 'https://api.example.com/',
    });
    expect(result.code).toBe('html_endpoint');
    expect(result.action).toBe('fix_v1');
    expect(result.suggestedBaseUrl).toBe('https://api.example.com/v1');
  });

  test('does not double-append /v1 when already present', () => {
    expect(appendV1ToBaseUrl('https://api.openai.com/v1')).toBeUndefined();
    expect(appendV1ToBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1');
  });

  test('classifies connection refused and timeout errors cleanly', () => {
    expect(classifyProviderError({ raw: 'connect ECONNREFUSED 127.0.0.1:11434' }).code).toBe(
      'refused',
    );
    expect(classifyProviderError({ raw: 'request ETIMEDOUT' }).code).toBe('timeout');
    expect(maskSecretsInError('magpie failed with sk-abcdef12345')).not.toMatch(
      /magpie|abcdef12345/i,
    );
  });

  test('neutralizes internal runtime brand in providerName as well as raw detail', () => {
    const result = classifyProviderError({
      raw: 'ECONNREFUSED 127.0.0.1:3425',
      providerName: 'Magpie',
    });
    expect(result.title).not.toMatch(/magpie/i);
    expect(result.hint).not.toMatch(/magpie/i);
  });
});
