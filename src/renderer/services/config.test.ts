// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { ConfigService } from './config';
import { localStore } from './store';
import { defaultConfig } from '../config';
vi.mock('./store', () => ({ localStore: { getItem: vi.fn(), setItem: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
test('does not expose legacy providers, keys or model defaults as live configuration', async () => {
  vi.mocked(localStore.getItem).mockResolvedValue({
    ...defaultConfig,
    providers: { old: { apiKey: 'fixture' } },
    api: { key: 'fixture' },
    model: { defaultModel: 'old' },
  });
  const service = new ConfigService();
  const config = await service.reload();
  expect(config).not.toHaveProperty('providers');
  expect(config).not.toHaveProperty('api');
  expect(config).not.toHaveProperty('model');
});
test('serializes ordinary preference updates without rewriting unrelated history', async () => {
  let value: unknown = { ...defaultConfig, legacyMarker: 'preserved' };
  vi.mocked(localStore.getItem).mockImplementation(async () => value as never);
  vi.mocked(localStore.setItem).mockImplementation(async (_key, next) => {
    value = next;
  });
  const service = new ConfigService();
  await Promise.all([
    service.updateConfig({ theme: 'dark' }),
    service.updateConfig({ language: 'en' }),
  ]);
  expect(service.getConfig()).toMatchObject({ theme: 'dark', language: 'en' });
  expect(value).toMatchObject({ legacyMarker: 'preserved' });
});
