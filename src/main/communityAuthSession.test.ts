import { beforeEach, describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: electronMocks.fetch },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { CommunityAuthSessionManager } from './communityAuthSession';

function createStore() {
  const values = new Map<string, unknown>();
  return {
    values,
    store: {
      get<T>(key: string): T | undefined {
        return values.get(key) as T | undefined;
      },
      set<T>(key: string, value: T): void {
        values.set(key, value);
      },
      delete(key: string): void {
        values.delete(key);
      },
    },
  };
}

function tokenPayload(accessToken: string, refreshToken: string, expiresIn = 900) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    user: { id: 'user-1', email: 'user@example.com' },
  };
}

beforeEach(() => {
  electronMocks.fetch.mockReset();
});

describe('CommunityAuthSessionManager', () => {
  test('issues and reuses a guest token when no account is signed in', async () => {
    const { store } = createStore();
    const manager = new CommunityAuthSessionManager(() => store);
    electronMocks.fetch.mockResolvedValue(
      Response.json({ access_token: 'guest-access', expires_in: 900, token_type: 'Bearer' }),
    );

    await expect(manager.getModelPoolAccessToken()).resolves.toBe('guest-access');
    await expect(manager.getModelPoolAccessToken()).resolves.toBe('guest-access');
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    const request = electronMocks.fetch.mock.calls[0];
    expect(request?.[0]).toBe('https://account.rongxzyai.com/v1/auth/guest');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      installation_id: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    });
  });

  test('prefers an account token after the user signs in', async () => {
    const { store } = createStore();
    const manager = new CommunityAuthSessionManager(() => store);
    manager.saveTokenPayload(tokenPayload('account-access', 'refresh-1'));

    await expect(manager.getModelPoolAccessToken()).resolves.toBe('account-access');
    expect(electronMocks.fetch).not.toHaveBeenCalled();
  });

  test('keeps access tokens inside encrypted main-process storage', async () => {
    const { store } = createStore();
    const manager = new CommunityAuthSessionManager(() => store);
    manager.saveTokenPayload(tokenPayload('access-1', 'refresh-1'));

    expect(manager.getUser()).toEqual({ id: 'user-1', email: 'user@example.com' });
    await expect(manager.getAccessToken()).resolves.toBe('access-1');
    expect(electronMocks.fetch).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent refreshes and persists rotated tokens', async () => {
    const { store } = createStore();
    const manager = new CommunityAuthSessionManager(() => store);
    manager.saveTokenPayload(tokenPayload('expired-access', 'refresh-1', 1), 0);
    electronMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify(tokenPayload('access-2', 'refresh-2')), { status: 200 }),
    );

    await expect(
      Promise.all([manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()]),
    ).resolves.toEqual(['access-2', 'access-2', 'access-2']);
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    await expect(manager.getAccessToken()).resolves.toBe('access-2');
  });

  test('clears the session when refresh credentials are rejected', async () => {
    const { store } = createStore();
    const manager = new CommunityAuthSessionManager(() => store);
    manager.saveTokenPayload(tokenPayload('expired-access', 'refresh-1', 1), 0);
    electronMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );

    await expect(manager.getAccessToken()).rejects.toThrow('status 400');
    expect(manager.getUser()).toBeNull();
  });
});
