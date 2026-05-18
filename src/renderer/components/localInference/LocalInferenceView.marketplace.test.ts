import { expect, test } from 'vitest';

test('marketplace page sizing defaults stay within supported range', async () => {
  const module = await import('./LocalInferenceView');
  const estimateMarketplacePageSize = (module as unknown as {
    __test__estimateMarketplacePageSize?: () => number;
  }).__test__estimateMarketplacePageSize;

  expect(typeof estimateMarketplacePageSize).toBe('function');
  if (!estimateMarketplacePageSize) return;

  const pageSize = estimateMarketplacePageSize();
  expect(pageSize).toBeGreaterThanOrEqual(6);
  expect(pageSize).toBeLessThanOrEqual(24);
});

test('llama.cpp service config field metadata uses UI parameter keys without CLI prefixes', async () => {
  const module = await import('./LocalInferenceView');
  const getServiceConfigFields = (module as unknown as {
    __test__getServiceConfigFields?: () => Array<{ key: string; paramName: string }>;
  }).__test__getServiceConfigFields;

  expect(typeof getServiceConfigFields).toBe('function');
  if (!getServiceConfigFields) return;

  const fields = getServiceConfigFields();
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.map((field) => field.paramName)).toContain('parallel');
  expect(fields.every((field) => !field.paramName.startsWith('--'))).toBe(true);
});

test('llama.cpp inference option metadata uses OpenAI-compatible request parameter keys', async () => {
  const module = await import('./LocalInferenceView');
  const getInferenceOptionFields = (module as unknown as {
    __test__getInferenceOptionFields?: () => Array<{ key: string; paramName: string }>;
  }).__test__getInferenceOptionFields;

  expect(typeof getInferenceOptionFields).toBe('function');
  if (!getInferenceOptionFields) return;

  const paramNames = getInferenceOptionFields().map((field) => field.paramName);
  expect(paramNames).toContain('max_tokens');
  expect(paramNames).toContain('reasoning_format');
  expect(paramNames).toContain('thinking_forced_open');
  expect(paramNames).not.toContain('num_predict');
  expect(paramNames.every((paramName) => !paramName.startsWith('--'))).toBe(true);
});
