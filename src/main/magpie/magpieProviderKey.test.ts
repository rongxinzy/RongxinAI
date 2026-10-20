import { describe, expect, it, vi } from 'vitest';
import type { MagpieProviderSummary } from '../../shared/magpie/types';
import {
  enrichMagpieProviderSummariesWithStoredKeys,
  isUsableMagpieProviderKey,
  parseMagpieProviderKeyResponse,
  providerRowNeedsStoredKeyLookup,
  MAGPIE_STORED_KEY_PROBE_CONCURRENCY,
} from './magpieProviderKey';

describe('magpieProviderKey', () => {
  it('treats placeholder and empty values as unusable', () => {
    expect(isUsableMagpieProviderKey(undefined)).toBe(false);
    expect(isUsableMagpieProviderKey('')).toBe(false);
    expect(isUsableMagpieProviderKey('none')).toBe(false);
    expect(isUsableMagpieProviderKey('magpie-local')).toBe(false);
    expect(isUsableMagpieProviderKey('sk-fixture-0001')).toBe(true);
  });

  it('parses provider/key responses without leaking extra fields', () => {
    expect(parseMagpieProviderKeyResponse({ key: 'sk-fixture' })).toBe('sk-fixture');
    expect(parseMagpieProviderKeyResponse({ secret: 'nope' })).toBeUndefined();
  });

  it('flags bullet-masked upstream rows for stored-key lookup', () => {
    expect(providerRowNeedsStoredKeyLookup({ key: { set: true, masked: '••••' } })).toBe(true);
    expect(providerRowNeedsStoredKeyLookup({ key: { set: true, masked: 'sk-…7890' } })).toBe(false);
    expect(providerRowNeedsStoredKeyLookup({ key: { set: true, masked: 'sk-live' } })).toBe(false);
  });

  it('enriches only bullet-masked rows and keeps projected summaries when a probe fails', async () => {
    const list: MagpieProviderSummary[] = [
      {
        id: 'bullet',
        name: 'Bullet',
        api: 'openai-completions',
        baseUrl: 'https://api.example/v1',
        models: [],
        off: false,
        isHostManaged: false,
        hasKey: false,
        keyMasked: '••••',
        fallback: [],
      },
      {
        id: 'visible',
        name: 'Visible',
        api: 'openai-completions',
        baseUrl: 'https://api.example/v1',
        models: [],
        off: false,
        isHostManaged: false,
        hasKey: true,
        keyMasked: 'sk-…1234',
        fallback: [],
      },
    ];
    const rawList = [
      { id: 'bullet', key: { set: true, masked: '••••' } },
      { id: 'visible', key: { set: true, masked: 'sk-…1234' } },
    ];
    const fetchStoredKey = vi.fn(async (id: string) => {
      if (id === 'bullet') throw new Error('upstream down');
      return 'sk-should-not-run';
    });
    await enrichMagpieProviderSummariesWithStoredKeys(list, rawList, fetchStoredKey);
    expect(fetchStoredKey).toHaveBeenCalledTimes(1);
    expect(fetchStoredKey).toHaveBeenCalledWith('bullet');
    expect(list[0]).toMatchObject({ hasKey: false, keyMasked: '••••' });
    expect(list[1]).toMatchObject({ hasKey: true, keyMasked: 'sk-…1234' });
  });

  it('applies stored keys for bullet-masked rows with bounded concurrency', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const list: MagpieProviderSummary[] = ids.map(id => ({
      id,
      name: id,
      api: 'openai-completions',
      baseUrl: 'https://api.example/v1',
      models: [],
      off: false,
      isHostManaged: false,
      hasKey: false,
      keyMasked: '••••',
      fallback: [],
    }));
    const rawList = ids.map(id => ({ id, key: { set: true, masked: '••••' } }));
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchStoredKey = vi.fn(async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return `sk-${id}`;
    });
    await enrichMagpieProviderSummariesWithStoredKeys(
      list,
      rawList,
      fetchStoredKey,
      MAGPIE_STORED_KEY_PROBE_CONCURRENCY,
    );
    expect(fetchStoredKey).toHaveBeenCalledTimes(ids.length);
    expect(maxInFlight).toBeLessThanOrEqual(MAGPIE_STORED_KEY_PROBE_CONCURRENCY);
    for (const summary of list) {
      expect(summary.hasKey).toBe(true);
    }
  });
});
