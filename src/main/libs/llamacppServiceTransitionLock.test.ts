import { expect, test } from 'vitest';

import { LlamaCppServiceTransitionLock } from './llamacppServiceTransitionLock';

test('blocks a second service transition until the active transition completes', async () => {
  const lock = new LlamaCppServiceTransitionLock();
  let finish!: () => void;
  const firstTransition = lock.runExclusive(
    () => new Promise<void>(resolve => {
      finish = resolve;
    }),
    () => new Error('service transition in progress'),
  );
  expect(lock.isActive()).toBe(true);

  await expect(lock.runExclusive(
    async () => undefined,
    () => new Error('service transition in progress'),
  )).rejects.toThrow('service transition in progress');

  finish();
  await expect(firstTransition).resolves.toBeUndefined();
  expect(lock.isActive()).toBe(false);
  await expect(lock.runExclusive(
    async () => 'ready',
    () => new Error('service transition in progress'),
  )).resolves.toBe('ready');
});
