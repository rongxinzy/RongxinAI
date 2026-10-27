import { expect, test } from 'vitest';

export function claudeApiKey(raw: string): string | undefined {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const env = (parsed as { env?: unknown }).env;
  if (!env || typeof env !== 'object') return undefined;
  const key = (env as { ANTHROPIC_API_KEY?: unknown }).ANTHROPIC_API_KEY;
  return typeof key === 'string' ? key : undefined;
}

export function piModelRef(raw: string): string | undefined {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  const provider =
    typeof record.provider === 'string'
      ? record.provider
      : typeof record.defaultProvider === 'string'
        ? record.defaultProvider
        : undefined;
  if (typeof record.defaultModel === 'string') {
    return record.defaultModel.includes('/') || !provider
      ? record.defaultModel
      : `${provider}/${record.defaultModel}`;
  }
  if (record.defaultModel && typeof record.defaultModel === 'object') {
    const nested = record.defaultModel as Record<string, unknown>;
    if (typeof nested.provider === 'string' && typeof nested.model === 'string') {
      return `${nested.provider}/${nested.model}`;
    }
  }
  if (provider && typeof record.model === 'string') return `${provider}/${record.model}`;
  return undefined;
}

test('keeps the claude api key when formatting changes', () => {
  expect(claudeApiKey('{"env":{"ANTHROPIC_API_KEY":"fixture-key"}}')).toBe('fixture-key');
});

test('keeps the pi model when defaultModel is split', () => {
  expect(piModelRef(JSON.stringify({ defaultModel: 'fixture/pi-model' }))).toBe('fixture/pi-model');
  expect(piModelRef(JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'pi-model' }))).toBe(
    'fixture/pi-model',
  );
  expect(
    piModelRef(JSON.stringify({ defaultModel: { provider: 'fixture', model: 'pi-model' } })),
  ).toBe('fixture/pi-model');
});
