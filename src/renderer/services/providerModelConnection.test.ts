import { expect, test } from 'vitest';

import { getProviderModelConnectionTestResult } from './providerModelConnection';

test('treats a model output limit response as successful connectivity', () => {
  expect(
    getProviderModelConnectionTestResult({
      ok: false,
      status: 400,
      data: { error: { message: 'Model output limit was reached' } },
    }),
  ).toEqual({ success: true });
});

test('returns the provider error message for a failed connectivity test', () => {
  expect(
    getProviderModelConnectionTestResult({
      ok: false,
      status: 401,
      data: { error: { message: 'Invalid API key' } },
    }),
  ).toEqual({ success: false, message: 'Invalid API key' });
});
