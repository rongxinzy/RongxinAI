import { describe, expect, it, vi } from 'vitest';

import type { LlamaCppServiceConfig } from '../../shared/llamacpp';
import { isLlamaCppLanAccessEnabled, syncMagpieLanAccessKey } from './lanAccess';

type Call = { route: string; body?: Record<string, unknown> };

function fakeManagement(
  initialKeys: Array<{ id: string; name: string; off?: boolean; secret?: string }>,
) {
  const calls: Call[] = [];
  const keys = new Map(initialKeys.map(key => [key.id, { ...key }]));
  const client = {
    calls,
    managementJson: vi.fn(
      async (route: string, init?: RequestInit): Promise<Record<string, unknown>> => {
        const body = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : undefined;
        calls.push({ route, body });
        if (route === '/api/caller-keys')
          return { keys: [...keys.values()].map(({ secret: _secret, ...rest }) => rest) };
        if (route === '/api/caller-keys/copy-key') {
          const key = keys.get(String(body?.key));
          // Mirrors the real handler: the wrapped access.Update result.
          return { keys: [], secret: key?.secret ?? '' };
        }
        if (route === '/api/caller-keys/add-key') {
          const id = `key-${keys.size + 1}`;
          keys.set(id, { id, name: String(body?.name), secret: String(body?.secret) });
          return { keys: [] };
        }
        if (route === '/api/caller-keys/remove-key') {
          keys.delete(String(body?.key));
          return { keys: [] };
        }
        throw new Error(`unexpected route ${route}`);
      },
    ),
  };
  return { client, calls };
}

describe('isLlamaCppLanAccessEnabled', () => {
  it('treats either LAN signal as enabled', () => {
    expect(isLlamaCppLanAccessEnabled({})).toBe(false);
    expect(isLlamaCppLanAccessEnabled({ gatewayAccessMode: 'lan' } as LlamaCppServiceConfig)).toBe(
      true,
    );
    expect(isLlamaCppLanAccessEnabled({ listenHost: '0.0.0.0' })).toBe(true);
    expect(isLlamaCppLanAccessEnabled({ listenHost: '127.0.0.1' })).toBe(false);
  });
});

describe('syncMagpieLanAccessKey', () => {
  it('creates the key once and keeps it on later syncs', async () => {
    const { client, calls } = fakeManagement([]);
    await syncMagpieLanAccessKey(client, 'sk-lan-one');
    await syncMagpieLanAccessKey(client, 'sk-lan-one');
    const addCalls = calls.filter(call => call.route === '/api/caller-keys/add-key');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].body).toEqual({ name: 'zhiyuan-lan', secret: 'sk-lan-one' });
    expect(calls.some(call => call.route === '/api/caller-keys/remove-key')).toBe(false);
  });

  it('issues only the copy probe when the existing key already holds the secret', async () => {
    const { client, calls } = fakeManagement([
      { id: 'key-1', name: 'zhiyuan-lan', secret: 'sk-lan-one' },
    ]);
    await syncMagpieLanAccessKey(client, 'sk-lan-one');
    expect(calls.map(call => call.route)).toEqual([
      '/api/caller-keys',
      '/api/caller-keys/copy-key',
    ]);
  });

  it('replaces the key after the token is regenerated, adding the new secret first', async () => {
    const { client, calls } = fakeManagement([
      { id: 'key-1', name: 'zhiyuan-lan', secret: 'sk-lan-old' },
    ]);
    await syncMagpieLanAccessKey(client, 'sk-lan-new');
    const routes = calls.map(call => call.route);
    // The refreshed secret must exist before the stale key is removed.
    expect(routes.indexOf('/api/caller-keys/add-key')).toBeLessThan(
      routes.indexOf('/api/caller-keys/remove-key'),
    );
    const remove = calls.find(call => call.route === '/api/caller-keys/remove-key');
    expect(remove?.body).toEqual({ key: 'key-1' });
  });

  it('leaves unrelated keys alone', async () => {
    const { client, calls } = fakeManagement([
      { id: 'key-1', name: 'zhiyuan-lan', secret: 'sk-lan-old' },
      { id: 'key-2', name: 'Laptop', secret: 'sk-other' },
    ]);
    await syncMagpieLanAccessKey(client, 'sk-lan-new');
    const removed = calls
      .filter(call => call.route === '/api/caller-keys/remove-key')
      .map(call => call.body?.key);
    expect(removed).toEqual(['key-1']);
  });

  it('rejects an empty token', async () => {
    const { client } = fakeManagement([]);
    await expect(syncMagpieLanAccessKey(client, '  ')).rejects.toThrow('LAN access token');
  });
});
