import { expect, test } from 'vitest';

import { CcConnectRuntimeStatusRegistry } from './ccConnectRuntimeStatusRegistry';

test('replaces runtime health with normalized account activity', () => {
  const registry = new CcConnectRuntimeStatusRegistry();
  registry.replace([
    {
      accountId: 'account',
      platform: 'telegram',
      state: 'ready',
      startedAt: '2026-08-13T10:00:00Z',
      lastInboundAt: '2026-08-13T10:01:00Z',
    },
  ]);
  expect(registry.get('account')).toEqual({
    connected: true,
    lastError: null,
    startedAt: Date.parse('2026-08-13T10:00:00Z'),
    lastInboundAt: Date.parse('2026-08-13T10:01:00Z'),
    lastOutboundAt: null,
  });
  registry.replace([]);
  expect(registry.get('account').connected).toBe(false);
});

test('records startup failures without retaining stale activity', () => {
  const registry = new CcConnectRuntimeStatusRegistry();
  registry.markUnavailable('account', new Error('runtime failed'));
  expect(registry.get('account')).toMatchObject({ connected: false, lastError: 'runtime failed' });
});
