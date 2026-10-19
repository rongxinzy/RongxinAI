// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';

import { localStore } from './store';

afterEach(() => {
  vi.restoreAllMocks();
  window.electron = undefined as unknown as typeof window.electron;
});

test('getItem preserves falsy values and only maps missing keys to null', async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce('')
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(undefined);
  window.electron = {
    store: { get, set: vi.fn(), remove: vi.fn() },
  } as unknown as typeof window.electron;

  expect(await localStore.getItem('a')).toBe(0);
  expect(await localStore.getItem('b')).toBe(false);
  expect(await localStore.getItem('c')).toBe('');
  expect(await localStore.getItem('d')).toBe(null);
  expect(await localStore.getItem('e')).toBe(null);
  expect(get).toHaveBeenCalledTimes(5);
});

test('getItem swallows store failures and reports null', async () => {
  window.electron = {
    store: { get: vi.fn().mockRejectedValue(new Error('offline')), set: vi.fn(), remove: vi.fn() },
  } as unknown as typeof window.electron;

  expect(await localStore.getItem('a')).toBe(null);
});
