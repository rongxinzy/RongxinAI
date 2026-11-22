import { beforeEach, expect, test, vi } from 'vitest';

import { refreshMcpOAuthRecord, shutdownMcpOAuthRefreshes } from '../appBootstrap/mcpOAuthHeaders';
import { getMcpStore, getStore } from '../appBootstrap/runtimeServices';
import type { McpServerRecord, McpStore } from '../mcpStore';
import type { SqliteStore } from '../sqliteStore';
import { McpCredentialVault } from './mcpCredentialVault';
import { McpOAuthManager, MCP_OAUTH_STORE_PREFIX } from './mcpOAuthManager';

const { oauthFetch, openExternal } = vi.hoisted(() => ({
  oauthFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock('electron', () => ({
  session: { defaultSession: { fetch: oauthFetch } },
  shell: { openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock('../appBootstrap/runtimeServices', () => ({ getStore: vi.fn(), getMcpStore: vi.fn() }));

const serverUrl = 'https://mcp.example.test/mcp';
const issuer = 'https://issuer.example.test/';
const registryKey = 'fixture';
const storageKey = `${MCP_OAUTH_STORE_PREFIX}${registryKey}`;
const clientInformation = { client_id: 'fixture-client' };
const tokens = {
  access_token: 'fixture-old',
  refresh_token: 'fixture-refresh',
  token_type: 'Bearer',
  issuer,
};

function fixture() {
  const values = new Map<string, unknown>();
  const store = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
    }),
    delete: (key: string) => {
      values.delete(key);
    },
  };
  const vault = new McpCredentialVault(store);
  return { store, vault, manager: new McpOAuthManager(store as unknown as SqliteStore) };
}

function fakeOAuth(tokenResponse: (init?: RequestInit) => Response | Promise<Response>) {
  oauthFetch.mockImplementation(async (url, init) => {
    switch (new URL(url).pathname) {
      case '/.well-known/oauth-protected-resource/mcp':
        return Response.json({ resource: serverUrl, authorization_servers: [issuer] });
      case '/.well-known/oauth-authorization-server':
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          registration_endpoint: `${issuer}register`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        });
      case '/register':
        return Response.json({ ...clientInformation, ...JSON.parse(String(init?.body)) });
      case '/token':
        return tokenResponse(init);
      default:
        return new Response(null, { status: 404 });
    }
  });
}

beforeEach(() => {
  oauthFetch.mockReset();
  openExternal.mockReset();
  openExternal.mockResolvedValue();
});

test('SDK refresh failure never opens a browser or saves an interactive verifier', async () => {
  fakeOAuth(() => Response.json({ error: 'server_error' }, { status: 500 }));
  const { manager, store, vault } = fixture();
  const session = {
    clientInformation,
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens,
  };
  vault.setValue(storageKey, session);
  store.set.mockClear();

  const result = await manager.refreshAccessToken(registryKey, serverUrl);

  expect(openExternal).not.toHaveBeenCalled();
  expect(store.set).not.toHaveBeenCalled();
  expect(result).toBeNull();
  expect(vault.getValue(storageKey)).toEqual(session);
  expect(oauthFetch.mock.calls.filter(([url]) => new URL(url).pathname === '/token')).toHaveLength(
    1,
  );
});

test('a connector without stored authorization does not persist or discover OAuth state', async () => {
  const { manager, store } = fixture();

  await expect(manager.refreshAccessToken(registryKey, serverUrl)).resolves.toBeNull();
  expect(store.set).not.toHaveBeenCalled();
  expect(oauthFetch).not.toHaveBeenCalled();
});

test('successful silent refresh persists the SDK-issued token and legacy client issuer', async () => {
  fakeOAuth(() => Response.json({ access_token: 'fixture-new', token_type: 'Bearer' }));
  const { manager, vault } = fixture();
  vault.setValue(storageKey, {
    clientInformation,
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens,
  });

  await expect(manager.refreshAccessToken(registryKey, serverUrl)).resolves.toBe('fixture-new');
  expect(openExternal).not.toHaveBeenCalled();
  expect(vault.getValue(storageKey)).toMatchObject({
    clientInformation: { ...clientInformation, issuer },
    tokens: { ...tokens, access_token: 'fixture-new' },
  });
});

test('silent refresh does not register a client for a different issuer', async () => {
  fakeOAuth(() => new Response(null, { status: 500 }));
  const { manager, store, vault } = fixture();
  vault.setValue(storageKey, {
    clientInformation: { ...clientInformation, issuer: 'https://previous.example.test/' },
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens: { ...tokens, issuer: 'https://previous.example.test/' },
  });
  store.set.mockClear();

  await manager.refreshAccessToken(registryKey, serverUrl).catch(() => null);

  expect(openExternal).not.toHaveBeenCalled();
  expect(store.set).not.toHaveBeenCalled();
  expect(oauthFetch.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain('/register');
  expect(oauthFetch.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain('/token');
});

test('explicit authorization opens the browser and exchanges the loopback callback code', async () => {
  fakeOAuth(() => Response.json({ access_token: 'fixture-explicit', token_type: 'Bearer' }));
  const { manager } = fixture();
  const opening = Promise.withResolvers<URL>();
  openExternal.mockImplementationOnce(async url => {
    opening.resolve(new URL(url));
  });
  const cancellation = new AbortController();
  const authorizing = manager.authorize(registryKey, serverUrl, cancellation.signal);
  try {
    const authorizationUrl = await Promise.race([
      opening.promise,
      authorizing.then(() => {
        throw new Error('Authorization ended before opening the browser');
      }),
    ]);
    expect(authorizationUrl.pathname).toBe('/authorize');
    const callback = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'fixture-code');
    const response = await fetch(callback, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(1_000),
    });
    expect(response.ok).toBe(true);
    await response.text();
    await expect(authorizing).resolves.toBe('fixture-explicit');
    expect(openExternal).toHaveBeenCalledOnce();
  } finally {
    cancellation.abort();
    await authorizing.catch(() => undefined);
  }
});

test('cancelling a held explicit exchange closes the callback and prevents late credential writes', async () => {
  const heldResponse = Promise.withResolvers<Response>();
  const exchangeStarted = Promise.withResolvers<void>();
  fakeOAuth(() => {
    exchangeStarted.resolve();
    return heldResponse.promise;
  });
  const { manager, store } = fixture();
  const opening = Promise.withResolvers<URL>();
  openExternal.mockImplementationOnce(async url => {
    opening.resolve(new URL(url));
  });
  const cancellation = new AbortController();
  const authorizing = manager.authorize(registryKey, serverUrl, cancellation.signal);
  const outcome = authorizing.catch((error: unknown) => error);
  try {
    const authorizationUrl = await Promise.race([opening.promise, authorizing]);
    expect(authorizationUrl).toBeInstanceOf(URL);
    const callback = new URL((authorizationUrl as URL).searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'fixture-code');
    const response = await fetch(callback, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(1_000),
    });
    await response.text();
    await Promise.race([exchangeStarted.promise, authorizing]);
    store.set.mockClear();

    cancellation.abort();
    expect(await outcome).toEqual(new Error('MCP authorization was cancelled'));
    await expect(fetch(callback, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();
    heldResponse.resolve(Response.json({ access_token: 'fixture-late', token_type: 'Bearer' }));
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(store.set.mock.calls.length).toBe(0);
    const tokenRequest = oauthFetch.mock.calls.find(([url]) => new URL(url).pathname === '/token');
    expect(tokenRequest?.[1]?.signal?.aborted).toBe(true);
  } finally {
    cancellation.abort();
    heldResponse.resolve(new Response(null, { status: 500 }));
    await outcome;
  }
});

test('an older silent response cannot replace credentials saved by explicit authorization', async () => {
  const heldRefresh = Promise.withResolvers<Response>();
  const refreshStarted = Promise.withResolvers<void>();
  let refreshingRequests = 0;
  fakeOAuth(init => {
    const grant = new URLSearchParams(String(init?.body)).get('grant_type');
    if (grant === 'authorization_code') {
      return Response.json({ access_token: 'fixture-explicit', token_type: 'Bearer' });
    }
    if (++refreshingRequests === 1) {
      refreshStarted.resolve();
      return heldRefresh.promise;
    }
    return Response.json({ error: 'server_error' }, { status: 500 });
  });
  const { manager, store, vault } = fixture();
  vault.setValue(storageKey, {
    clientInformation: { ...clientInformation, issuer },
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens,
  });
  const refreshing = manager.refreshAccessToken(registryKey, serverUrl);
  await Promise.race([
    refreshStarted.promise,
    refreshing.then(() => {
      throw new Error('Refresh completed before reaching the held response');
    }),
  ]);
  const opening = Promise.withResolvers<URL>();
  openExternal.mockImplementationOnce(async url => {
    opening.resolve(new URL(url));
  });
  const cancellation = new AbortController();
  const authorizing = manager.authorize(registryKey, serverUrl, cancellation.signal);
  try {
    const authorizationUrl = await Promise.race([
      opening.promise,
      authorizing.then(() => {
        throw new Error('Authorization finished without a browser callback');
      }),
    ]);
    const callback = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'fixture-code');
    const response = await fetch(callback, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(1_000),
    });
    await response.text();
    expect((await authorizing) === 'fixture-explicit').toBe(true);
    store.set.mockClear();

    heldRefresh.resolve(Response.json({ access_token: 'fixture-stale', token_type: 'Bearer' }));
    const result = await refreshing;
    expect(store.set.mock.calls.length).toBe(0);
    expect(result === null).toBe(true);
    const session = vault.getValue<{ tokens: { access_token: string } }>(storageKey);
    expect(session?.tokens.access_token === 'fixture-explicit').toBe(true);
    expect(openExternal).toHaveBeenCalledOnce();
  } finally {
    cancellation.abort();
    heldRefresh.resolve(new Response(null, { status: 500 }));
    await Promise.allSettled([refreshing, authorizing]);
  }
});

test('a silent refresh does not recreate credentials removed while its token request is pending', async () => {
  const response = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  fakeOAuth(() => {
    started.resolve();
    return response.promise;
  });
  const { manager, store, vault } = fixture();
  vault.setValue(storageKey, {
    clientInformation,
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens,
  });
  const refreshing = manager.refreshAccessToken(registryKey, serverUrl);
  try {
    await Promise.race([
      started.promise,
      refreshing.then(() => {
        throw new Error('Refresh completed before reaching the held response');
      }),
    ]);
    vault.deleteValue(storageKey);
    store.set.mockClear();
    response.resolve(Response.json({ access_token: 'fixture-stale', token_type: 'Bearer' }));

    const result = await refreshing;
    expect(store.set.mock.calls.length).toBe(0);
    expect(result === null).toBe(true);
    expect(vault.getValue(storageKey) === undefined).toBe(true);
  } finally {
    response.resolve(new Response(null, { status: 500 }));
    await Promise.allSettled([refreshing]);
  }
});

test('quit cancels a held background fetch and discards a late token response', async () => {
  const started = Promise.withResolvers<AbortSignal | null | undefined>();
  const response = Promise.withResolvers<Response>();
  fakeOAuth(init => {
    started.resolve(init?.signal);
    return response.promise;
  });
  const { store, vault } = fixture();
  vault.setValue(storageKey, {
    clientInformation,
    clientRedirectUri: 'http://127.0.0.1:18010/mcp-oauth/callback',
    tokens,
  });
  const record: McpServerRecord = {
    id: 'fixture-id',
    name: 'Fixture',
    description: '',
    registryId: registryKey,
    url: serverUrl,
    headers: { Authorization: 'Bearer fixture-old' },
    enabled: true,
    transportType: 'http',
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const updateServer = vi.fn();
  vi.mocked(getStore).mockReturnValue(store as unknown as SqliteStore);
  vi.mocked(getMcpStore).mockReturnValue({
    getRegistryOwner: () => record,
    updateServer,
  } as unknown as McpStore);
  store.set.mockClear();

  const refreshing = refreshMcpOAuthRecord(record);
  const signal = await Promise.race([
    started.promise,
    refreshing.then(() => {
      throw new Error('OAuth refresh settled before reaching the held token request');
    }),
  ]);
  const stopping = shutdownMcpOAuthRefreshes();
  try {
    await stopping;
    expect(signal?.aborted).toBe(true);
    await expect(
      refreshMcpOAuthRecord({ ...record, url: `${serverUrl}/other` }),
    ).resolves.toMatchObject({
      headers: record.headers,
    });
    expect(getStore).toHaveBeenCalledOnce();
    expect(store.set).not.toHaveBeenCalled();
    expect(updateServer).not.toHaveBeenCalled();

    const read = vi.spyOn(store, 'get');
    response.resolve(Response.json({ access_token: 'fixture-new', token_type: 'Bearer' }));
    await expect(refreshing).resolves.toBe(record);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(read).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(updateServer).not.toHaveBeenCalled();
  } finally {
    response.resolve(new Response(null, { status: 500 }));
    await stopping;
  }
});
