import { describe, expect, test, vi } from 'vitest';

import type { EnterpriseSessionSnapshot } from '../../shared/enterpriseSession';
import type { ZhiyuanEnterpriseSessionProvider } from './contract';
import { ZhiyuanEnterpriseSessionBridge } from './sessionBridge';

describe('Zhiyuan enterprise session bridge', () => {
  test('returns unavailable without exposing a generic extension channel', async () => {
    const bridge = new ZhiyuanEnterpriseSessionBridge(vi.fn());

    await expect(bridge.snapshot()).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Zhiyuan enterprise session is unavailable.',
      },
    });
  });

  test('registers one provider and releases it idempotently', async () => {
    const bridge = new ZhiyuanEnterpriseSessionBridge(vi.fn());
    const provider = fixtureProvider();
    const unregister = bridge.registerProvider(provider);

    expect(() => bridge.registerProvider(fixtureProvider())).toThrow('already registered');
    await expect(bridge.snapshot()).resolves.toMatchObject({
      ok: true,
      snapshot: { status: 'signed-out' },
    });

    unregister();
    unregister();
    await expect(bridge.snapshot()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });

  test('validates and copies password inputs before invoking the provider', async () => {
    const login = vi.fn(async () => authenticatedSnapshot());
    const changePassword = vi.fn(async () => authenticatedSnapshot());
    const bridge = new ZhiyuanEnterpriseSessionBridge(vi.fn());
    bridge.registerProvider(fixtureProvider({ login, changePassword }));

    await expect(
      bridge.login({ enterpriseId: '  enterprise-1 ', username: ' admin ', password: ' secret ' }),
    ).resolves.toMatchObject({ ok: true });
    expect(login).toHaveBeenCalledWith({
      enterpriseId: 'enterprise-1',
      username: 'admin',
      password: ' secret ',
    });

    await expect(
      bridge.login({ enterpriseId: ' ', username: 'admin', password: 'secret' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      bridge.changePassword({ currentPassword: '', newPassword: 'new' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('normalizes identities and does not return provider-owned mutable values', async () => {
    const providerSnapshot = authenticatedSnapshot();
    const bridge = new ZhiyuanEnterpriseSessionBridge(vi.fn());
    bridge.registerProvider(fixtureProvider({ snapshot: vi.fn(async () => providerSnapshot) }));

    const result = await bridge.snapshot();
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        status: 'authenticated',
        identity: { user: { displayName: 'Administrator' }, roles: ['admin'] },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok && result.snapshot.status === 'authenticated') {
      expect(result.snapshot.identity).not.toBe(providerSnapshot.identity);
      expect(Object.isFrozen(result.snapshot.identity.roles)).toBe(true);
    }
  });

  test('logs provider failures and returns a generic renderer error', async () => {
    const logError = vi.fn();
    const bridge = new ZhiyuanEnterpriseSessionBridge(logError);
    bridge.registerProvider(
      fixtureProvider({
        login: vi.fn(async () => {
          throw new Error('backend included a sensitive detail');
        }),
      }),
    );

    const result = await bridge.login({
      enterpriseId: 'enterprise-1',
      username: 'admin',
      password: 'secret',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'OPERATION_FAILED',
        message: 'Zhiyuan enterprise session operation failed.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive detail');
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

function fixtureProvider(
  overrides: Partial<ZhiyuanEnterpriseSessionProvider> = {},
): ZhiyuanEnterpriseSessionProvider {
  return {
    snapshot: vi.fn(async () => ({ status: 'signed-out' })),
    login: vi.fn(async () => authenticatedSnapshot()),
    changePassword: vi.fn(async () => authenticatedSnapshot()),
    logout: vi.fn(async () => ({ status: 'signed-out' })),
    ...overrides,
  };
}

function authenticatedSnapshot(): Extract<EnterpriseSessionSnapshot, { status: 'authenticated' }> {
  return {
    status: 'authenticated',
    identity: {
      user: { id: 'user-1', displayName: 'Administrator' },
      enterprise: { id: 'enterprise-1', name: 'Zhiyuan' },
      roles: ['admin'],
      sessionExpiresAt: '2026-08-24T11:00:00Z',
      passwordChangeRequired: false,
    },
  };
}
