import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ProviderName } from '@shared/providers';
import type { AppConfig } from '../config';
import { defaultConfig } from '../config';
import { ConfigService } from './config';
import { localStore } from './store';

vi.mock('./store', () => ({
  localStore: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

const cloneConfig = (): AppConfig => structuredClone(defaultConfig);

describe('ConfigService', () => {
  let storedConfig: AppConfig;

  beforeEach(() => {
    storedConfig = cloneConfig();
    vi.mocked(localStore.getItem).mockImplementation(async () => structuredClone(storedConfig));
    vi.mocked(localStore.setItem).mockImplementation(async (_key, value) => {
      storedConfig = structuredClone(value as AppConfig);
    });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
  });

  test('repairs managed access disabled by legacy key validation and preserves user providers', async () => {
    storedConfig.providers![ProviderName.Zhiyuan].enabled = false;
    storedConfig.providers![ProviderName.Zhiyuan].apiKey = '';
    storedConfig.providers![ProviderName.Zhiyuan].models = [];
    storedConfig.providers![ProviderName.DeepSeek].enabled = false;
    const service = new ConfigService();
    await service.reload();
    expect(service.getConfig().providers![ProviderName.Zhiyuan].enabled).toBe(true);
    expect(storedConfig.providers![ProviderName.Zhiyuan].enabled).toBe(true);
    expect(storedConfig.providers![ProviderName.Zhiyuan].models?.length).toBeGreaterThan(0);
    expect(service.getConfig().providers![ProviderName.Zhiyuan].apiKey).toBe('');
    expect(service.getConfig().providers![ProviderName.DeepSeek].enabled).toBe(false);

    const providers = structuredClone(service.getConfig().providers!);
    providers[ProviderName.Zhiyuan].enabled = false;
    await service.updateConfig({ providers, theme: 'light' });
    expect(storedConfig.providers![ProviderName.Zhiyuan].enabled).toBe(true);
    expect(storedConfig.providers![ProviderName.Zhiyuan].models?.length).toBeGreaterThan(0);
    expect(storedConfig.providers![ProviderName.DeepSeek].enabled).toBe(false);
    expect(storedConfig.theme).toBe('light');
  });

  test('serializes concurrent partial updates against the latest stored config', async () => {
    const service = new ConfigService();

    await Promise.all([
      service.updateConfig({ theme: 'dark' }),
      service.updateConfig({ language: 'en' }),
    ]);

    expect(storedConfig.theme).toBe('dark');
    expect(storedConfig.language).toBe('en');
  });

  test('does not re-inject a catalog model after the migration has completed', async () => {
    const service = new ConfigService();
    storedConfig.migrations = undefined;

    await service.init();

    expect(service.getConfig().migrations?.providerModelCatalog).toBe(1);
    storedConfig.providers!.openai.models = storedConfig.providers!.openai.models!.filter(
      model => model.id !== 'gpt-5.4',
    );

    await service.reload();

    expect(service.getConfig().providers!.openai.models).not.toContainEqual(
      expect.objectContaining({ id: 'gpt-5.4' }),
    );
  });

  test('orders reload after an in-flight update', async () => {
    const service = new ConfigService();

    const update = service.updateConfig({ theme: 'dark' });
    const reload = service.reload();
    await Promise.all([update, reload]);

    expect(service.getConfig().theme).toBe('dark');
  });
});
