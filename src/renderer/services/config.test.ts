import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ManagedProviderAccessMode } from '@shared/managedProviders';
import {
  applyProviderModelConnectionTestResults,
  createProviderConnectionTestSignature,
  ProviderName,
  ModelCapabilityStatus,
  type ProviderConfig,
} from '@shared/providers';
import type { AppConfig } from '../config';
import { defaultConfig } from '../config';
import { ConfigService } from './config';
import { localStore } from './store';
import { collectAvailableModels } from './availableModels';

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
    vi.clearAllMocks();
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

  test('merges queued provider updates after delayed writes without losing either provider', async () => {
    const service = new ConfigService();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.mocked(localStore.setItem).mockImplementationOnce(async (_key, value) => {
      await gate;
      storedConfig = structuredClone(value as AppConfig);
    });
    const save = (id: string) =>
      service.updateConfig(current => ({
        providers: {
          ...current.providers!,
          [id]: {
            ...current.providers![id],
            enabled: true,
            models: [{ id: 'five-models-tested', name: id }],
          },
        },
      }));
    const first = save(ProviderName.Moonshot);
    const second = save(ProviderName.OpenAI);
    release();
    await Promise.all([first, second]);
    for (const id of [ProviderName.Moonshot, ProviderName.OpenAI]) {
      expect(storedConfig.providers![id].enabled).toBe(true);
      expect(storedConfig.providers![id].models?.[0].id).toBe('five-models-tested');
    }
  });

  test('skips an invalidated queued update without publishing or writing', async () => {
    const service = new ConfigService();
    await service.updateConfig(() => undefined);
    expect(localStore.setItem).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
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

  test('keeps all tested coding-plan models selectable after save and repeated reload', async () => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      electron: { llamacpp: { listRunningModels: vi.fn(async () => []) } },
    });
    const provider: ProviderConfig = {
      ...storedConfig.providers![ProviderName.Moonshot],
      enabled: true,
      apiKey: 'test-key',
      codingPlanEnabled: true,
      models: ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3', 'k3-256k', 'new-model'].map(
        id => ({
          id,
          name: id,
          contextWindow: 1_000_000,
          maxTokens: 16_384,
          piRuntime: { reasoning: true },
        }),
      ),
    };
    const signature = await createProviderConnectionTestSignature({
      providerId: ProviderName.Moonshot,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat!,
      provider,
    });
    const tested = applyProviderModelConnectionTestResults(
      provider,
      provider.models!.map(model => ({ modelId: model.id, success: true })),
      signature,
    );
    const service = new ConfigService();
    await service.updateConfig({
      providers: { ...storedConfig.providers!, [ProviderName.Moonshot]: tested },
    });
    for (let reload = 0; reload < 2; reload += 1) {
      const config = await service.reload();
      expect(config.providers![ProviderName.Moonshot].models).toHaveLength(5);
      expect(config.providers![ProviderName.Moonshot].models?.[0].connectionTest).toEqual(
        tested.models?.[0].connectionTest,
      );
      expect(config.providers![ProviderName.Moonshot].models?.[0]).toMatchObject({
        contextWindow: 1_000_000,
        maxTokens: 16_384,
        piRuntime: { reasoning: true },
      });
      expect(
        config.providers![ProviderName.Moonshot].models?.every(
          model => model.capabilities?.toolCalling === ModelCapabilityStatus.Supported,
        ),
      ).toBe(true);
      const available = (await collectAvailableModels(config)).filter(
        model => model.providerKey === ProviderName.Moonshot,
      );
      expect(available.map(model => model.id)).toEqual(provider.models!.map(model => model.id));
    }
  });

  describe('exclusive managed provider policy', () => {
    const stubExclusiveManagedPolicy = () => {
      vi.stubGlobal('window', {
        dispatchEvent: vi.fn(),
        electron: {
          managedProviders: {
            policy: vi.fn(async () => ({
              mode: ManagedProviderAccessMode.Exclusive,
              providerKeys: ['custom_enterprise'],
            })),
          },
        },
      });
    };

    test('disables the seeded free model and persists the suppression', async () => {
      stubExclusiveManagedPolicy();
      const service = new ConfigService();
      await service.reload();

      expect(service.getConfig().providers![ProviderName.Zhiyuan].enabled).toBe(false);
      expect(storedConfig.providers![ProviderName.Zhiyuan].enabled).toBe(false);

      const providers = structuredClone(service.getConfig().providers!);
      providers[ProviderName.Zhiyuan].enabled = true;
      await service.updateConfig({ providers });
      expect(storedConfig.providers![ProviderName.Zhiyuan].enabled).toBe(false);
    });

    test('neither seeds nor repairs the free model while exclusive', async () => {
      storedConfig.providers![ProviderName.Zhiyuan].enabled = false;
      storedConfig.providers![ProviderName.Zhiyuan].models = [];
      stubExclusiveManagedPolicy();
      const service = new ConfigService();
      vi.mocked(localStore.setItem).mockClear();

      await service.reload();

      expect(service.getConfig().providers![ProviderName.Zhiyuan].enabled).toBe(false);
      expect(service.getConfig().providers![ProviderName.Zhiyuan].models).toEqual([]);
      expect(localStore.setItem).not.toHaveBeenCalled();
    });
  });
});
