import { expect, test } from 'vitest';
import { ZhiyuanManagedProviderBridge } from '../src/main/enterpriseExtension/managedProviderBridge';

test('fifty concurrent native credential requests share one refresh after invalidation', async () => {
  const bridge = new ZhiyuanManagedProviderBridge();
  let snapshots = 0;
  const dispose = bridge.registerSource({
    providerKey: 'custom_enterprise_concurrency',
    exclusive: true,
    snapshot: async () => {
      snapshots++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        enabled: true,
        apiKey: `fixture-token-${snapshots}`,
        baseUrl: 'https://enterprise.invalid/v1',
        models: [{ id: 'model', name: 'Model' }],
      };
    },
  });
  try {
    await bridge.refresh();
    const before = snapshots;
    bridge.invalidateToken();
    const tokens = await Promise.all(Array.from({ length: 50 }, () => bridge.getToken()));
    expect(new Set(tokens)).toEqual(new Set([`fixture-token-${before + 1}`]));
    expect(snapshots).toBe(before + 1);
  } finally {
    dispose();
  }
});

test('failed enterprise refresh can recover without retaining a rejected credential promise', async () => {
  const bridge = new ZhiyuanManagedProviderBridge();
  let unavailable = true;
  const dispose = bridge.registerSource({
    providerKey: 'custom_enterprise_recovery',
    exclusive: true,
    snapshot: async () => {
      if (unavailable) throw new Error('Enterprise authentication is unavailable.');
      return {
        enabled: true,
        apiKey: 'recovered-fixture-token',
        baseUrl: 'https://enterprise.invalid/v1',
        models: [{ id: 'model', name: 'Model' }],
      };
    },
  });
  try {
    await bridge.refresh();
    await expect(bridge.getToken()).rejects.toThrow('authentication is unavailable');
    unavailable = false;
    await expect(bridge.getToken()).resolves.toBe('recovered-fixture-token');
  } finally {
    dispose();
  }
});
