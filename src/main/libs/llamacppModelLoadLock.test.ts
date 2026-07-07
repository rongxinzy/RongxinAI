import { describe, expect, test, vi } from 'vitest';

import { LlamaCppModelLoadLock } from './llamacppModelLoadLock';

describe('LlamaCppModelLoadLock', () => {
  test('runs one model load action at a time', async () => {
    const lock = new LlamaCppModelLoadLock();
    let releaseFirstAction!: () => void;
    const firstAction = lock.runExclusive(
      'model-a',
      () => new Promise<string>(resolve => {
        releaseFirstAction = () => resolve('loaded-a');
      }),
      activeModelName => new Error(`blocked by ${activeModelName}`),
    );

    expect(lock.getActiveModelName()).toBe('model-a');
    await expect(lock.runExclusive(
      'model-b',
      async () => 'loaded-b',
      activeModelName => new Error(`blocked by ${activeModelName}`),
    )).rejects.toThrow('blocked by model-a');

    releaseFirstAction();
    await expect(firstAction).resolves.toBe('loaded-a');
    expect(lock.getActiveModelName()).toBeNull();
  });

  test('releases the lock when the action fails', async () => {
    const lock = new LlamaCppModelLoadLock();
    const action = vi.fn(async () => {
      throw new Error('load failed');
    });

    await expect(lock.runExclusive(
      'model-a',
      action,
      activeModelName => new Error(`blocked by ${activeModelName}`),
    )).rejects.toThrow('load failed');

    expect(lock.getActiveModelName()).toBeNull();
    await expect(lock.runExclusive(
      'model-b',
      async () => 'loaded-b',
      activeModelName => new Error(`blocked by ${activeModelName}`),
    )).resolves.toBe('loaded-b');
  });
});
