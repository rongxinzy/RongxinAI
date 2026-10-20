import { describe, expect, it } from 'vitest';
import {
  isUsableMagpieProviderKey,
  parseMagpieProviderKeyResponse,
  providerRowNeedsStoredKeyLookup,
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
  });
});
