import { expect, test } from 'vitest';

import { PendingIMConfigSync } from './im';

test('tracks a persisted channel configuration until it is applied', () => {
  const sync = new PendingIMConfigSync();

  expect(sync.isPending).toBe(false);
  sync.markPending();
  expect(sync.isPending).toBe(true);
  sync.markSynced();
  expect(sync.isPending).toBe(false);
});

test('keeps channel configuration pending after a failed sync attempt', () => {
  const sync = new PendingIMConfigSync();

  sync.markPending();
  expect(sync.isPending).toBe(true);
});
