import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ModelCapabilityStatus } from '../../../shared/providers';
import type { SqliteStore } from '../../sqliteStore';
import {
  disableModelImageInputCapability,
  setPiCapabilityCorrectionStoreGetter,
} from './piCapabilityCorrection';

interface FakeAppConfig {
  providers?: Record<
    string,
    {
      enabled: boolean;
      apiKey: string;
      baseUrl: string;
      models?: Array<{
        id: string;
        name: string;
        supportsImage?: boolean;
        capabilities?: Record<string, string>;
      }>;
    }
  >;
}

function createFakeStore(initial?: FakeAppConfig) {
  let current = initial;
  const set = vi.fn((_key: string, value: unknown) => {
    current = value as FakeAppConfig;
  });
  const store = {
    get: vi.fn((key: string) => (key === 'app_config' ? current : undefined)),
    set,
  } as unknown as SqliteStore;
  return { store, set, read: () => current };
}

describe('disableModelImageInputCapability', () => {
  beforeEach(() => {
    setPiCapabilityCorrectionStoreGetter(() => null);
  });

  test('downgrades a matching model entry in place', () => {
    const { store, read } = createFakeStore({
      providers: {
        custom_0: {
          enabled: true,
          apiKey: '',
          baseUrl: 'http://172.18.5.123:8000/v1',
          models: [
            {
              id: 'Qwen3-VL',
              name: 'Qwen3 VL',
              supportsImage: true,
              capabilities: { imageInput: ModelCapabilityStatus.Supported },
            },
          ],
        },
      },
    });
    setPiCapabilityCorrectionStoreGetter(() => store);

    // Model id matching is case-insensitive, same as resolveModelEndpoint.
    expect(disableModelImageInputCapability('custom_0', 'qwen3-vl')).toEqual({ changed: true });

    const model = read()?.providers?.custom_0.models?.[0];
    expect(model?.supportsImage).toBe(false);
    expect(model?.capabilities?.imageInput).toBe(ModelCapabilityStatus.Unsupported);
  });

  test('returns changed:false when the provider does not exist', () => {
    const { store, set } = createFakeStore({
      providers: {
        custom_0: { enabled: true, apiKey: '', baseUrl: 'http://localhost:8000/v1', models: [] },
      },
    });
    setPiCapabilityCorrectionStoreGetter(() => store);

    expect(disableModelImageInputCapability('custom_9', 'qwen3-vl')).toEqual({ changed: false });
    expect(set).not.toHaveBeenCalled();
  });

  test('creates a minimal model entry when the model is missing', () => {
    const { store, read } = createFakeStore({
      providers: {
        llamacpp: { enabled: true, apiKey: '', baseUrl: 'http://localhost:8080/v1' },
      },
    });
    setPiCapabilityCorrectionStoreGetter(() => store);

    expect(disableModelImageInputCapability('llamacpp', 'qwen-local')).toEqual({ changed: true });

    const models = read()?.providers?.llamacpp.models;
    expect(models).toEqual([
      {
        id: 'qwen-local',
        name: 'qwen-local',
        supportsImage: false,
        capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
      },
    ]);
  });

  test('returns changed:false when the entry is already unsupported', () => {
    const { store, set } = createFakeStore({
      providers: {
        custom_0: {
          enabled: true,
          apiKey: '',
          baseUrl: 'http://localhost:8000/v1',
          models: [
            {
              id: 'qwen-local',
              name: 'qwen-local',
              supportsImage: false,
              capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
            },
          ],
        },
      },
    });
    setPiCapabilityCorrectionStoreGetter(() => store);

    expect(disableModelImageInputCapability('custom_0', 'qwen-local')).toEqual({ changed: false });
    expect(set).not.toHaveBeenCalled();
  });

  test('returns changed:false when the store is not initialized', () => {
    expect(disableModelImageInputCapability('custom_0', 'qwen-local')).toEqual({ changed: false });
  });

  test('returns changed:false when app_config is missing', () => {
    const { store, set } = createFakeStore(undefined);
    setPiCapabilityCorrectionStoreGetter(() => store);

    expect(disableModelImageInputCapability('custom_0', 'qwen-local')).toEqual({ changed: false });
    expect(set).not.toHaveBeenCalled();
  });
});
