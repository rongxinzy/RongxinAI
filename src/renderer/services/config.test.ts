// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { ConfigService, configService } from './config';
import { localStore } from './store';
import { defaultConfig } from '../config';
import { i18nService } from './i18n/i18nService';
vi.mock('./store', () => ({ localStore: { getItem: vi.fn(), setItem: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
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

test('keeps the saved cache and emits no update when persistence fails', async () => {
  vi.mocked(localStore.getItem).mockResolvedValue({
    ...defaultConfig,
    sqliteAutoBackupEnabled: false,
  });
  const service = new ConfigService();
  await service.reload();
  const changed = vi.fn();
  window.addEventListener('config-updated', changed);
  vi.mocked(localStore.setItem).mockRejectedValueOnce(new Error('disk full'));
  try {
    await expect(service.updateConfig({ sqliteAutoBackupEnabled: true })).rejects.toThrow(
      'disk full',
    );
    expect(service.getConfig().sqliteAutoBackupEnabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('config-updated', changed);
  }
});

test('publishes the new cache only after saving and can retry a failed queued update', async () => {
  let stored = { ...defaultConfig, sqliteAutoBackupEnabled: false, legacyMarker: 'preserved' };
  vi.mocked(localStore.getItem).mockImplementation(async () => stored);
  const service = new ConfigService();
  await service.reload();
  vi.mocked(localStore.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(service.updateConfig({ sqliteAutoBackupEnabled: true })).rejects.toThrow(
    'disk full',
  );

  let release!: () => void;
  const saving = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.mocked(localStore.setItem).mockImplementationOnce(async (_key, next) => {
    expect(service.getConfig().sqliteAutoBackupEnabled).toBe(false);
    await saving;
    stored = next as typeof stored;
  });
  const retried = service.updateConfig({ sqliteAutoBackupEnabled: true });
  release();
  await retried;
  expect(service.getConfig().sqliteAutoBackupEnabled).toBe(true);
  expect(stored.legacyMarker).toBe('preserved');
  expect((await service.reload()).sqliteAutoBackupEnabled).toBe(true);
});

test('changing language during a pending backup save does not overwrite the backup preference', async () => {
  let stored = { ...defaultConfig, sqliteAutoBackupEnabled: false };
  vi.mocked(localStore.getItem).mockImplementation(async () => stored);
  await configService.reload();
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => {
    started = resolve;
  });
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.mocked(localStore.setItem).mockImplementation(async (_key, next) => {
    if (!stored.sqliteAutoBackupEnabled) {
      started();
      await pending;
    }
    stored = next as typeof stored;
  });
  const backup = configService.updateConfig({ sqliteAutoBackupEnabled: true });
  await writing;
  expect(configService.getConfig().sqliteAutoBackupEnabled).toBe(false);
  i18nService.setLanguage('en');
  release();
  await backup;
  expect(await configService.reload()).toMatchObject({
    language: 'en',
    sqliteAutoBackupEnabled: true,
  });
  expect(stored).toMatchObject({ language: 'en', sqliteAutoBackupEnabled: true });
  i18nService.setLanguage('zh', { persist: false });
});
