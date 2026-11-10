import { describe, expect, it } from 'vitest';
import type { MagpieModel, MagpieProviderSummary } from '../../../../shared/magpie/types';
import { summarizeProviderContexts } from './providerContextSummary';

const provider = (patch: Partial<MagpieProviderSummary> = {}): MagpieProviderSummary => ({
  id: 'relay',
  name: 'Relay',
  api: 'openai-completions',
  baseUrl: 'https://relay.test/v1',
  models: ['gpt-4o', 'glm-5-3-flash'],
  off: false,
  hasKey: true,
  ...patch,
});

const catalog = (...models: MagpieModel[]): MagpieModel[] => models;

describe('summarizeProviderContexts', () => {
  it('uses the wildcard declaration for every model', () => {
    const entries = summarizeProviderContexts(provider({ contexts: { '*': 65536 } }), catalog());
    expect(entries).toEqual([
      { modelId: 'gpt-4o', tokens: 65536, source: 'manual' },
      { modelId: 'glm-5-3-flash', tokens: 65536, source: 'manual' },
    ]);
  });

  it('lets a model override beat the wildcard', () => {
    const entries = summarizeProviderContexts(
      provider({ contexts: { '*': 65536, 'gpt-4o': 131072 } }),
      catalog(),
    );
    expect(entries[0]).toMatchObject({ modelId: 'gpt-4o', tokens: 131072, source: 'manual' });
    expect(entries[1]).toMatchObject({ modelId: 'glm-5-3-flash', tokens: 65536 });
  });

  it('falls back to the catalog window by exact or provider-prefixed id', () => {
    const entries = summarizeProviderContexts(
      provider(),
      catalog(
        { id: 'gpt-4o', context_window: 128000 },
        { id: 'vendor/glm-5-3-flash', context_window: 1000000 },
      ),
    );
    expect(entries).toEqual([
      { modelId: 'gpt-4o', tokens: 128000, source: 'auto' },
      { modelId: 'glm-5-3-flash', tokens: 1000000, source: 'auto' },
    ]);
  });

  it('reports models with no declaration and no catalog window as unset', () => {
    expect(summarizeProviderContexts(provider(), catalog())).toEqual([
      { modelId: 'gpt-4o', source: 'unset' },
      { modelId: 'glm-5-3-flash', source: 'unset' },
    ]);
  });

  it('does not borrow another provider window for a colliding model id', () => {
    const entries = summarizeProviderContexts(
      provider({ id: 'relay-a', models: ['gpt-4o'] }),
      catalog(
        { id: 'relay-b/gpt-4o', context_window: 32768 },
        { id: 'relay-a/gpt-4o', context_window: 128000 },
      ),
    );
    expect(entries).toEqual([{ modelId: 'gpt-4o', tokens: 128000, source: 'auto' }]);
  });

  it('marks host-managed windows as system even when the catalog supplies them', () => {
    const [entry] = summarizeProviderContexts(
      provider({ isHostManaged: true, models: ['ent-1'] }),
      catalog({ id: 'ent-1', context_window: 32768 }),
    );
    expect(entry).toEqual({ modelId: 'ent-1', tokens: 32768, source: 'system' });
  });

  it('marks host-managed declarations as system', () => {
    const [entry] = summarizeProviderContexts(
      provider({ isHostManaged: true, models: ['ent-1'], contexts: { '*': 32768 } }),
      catalog(),
    );
    expect(entry).toEqual({ modelId: 'ent-1', tokens: 32768, source: 'system' });
  });
});
