import { beforeEach, describe, expect, test, vi } from 'vitest';

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
