import type {
  AepSessionState,
  AepTokens,
  CurrentIdentity,
  ModelConnection,
  ServiceMetadata,
} from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import {
  AepMetadataError,
  type PasswordSessionClient,
  ZhiyuanPasswordSession,
} from './password-session.js';

describe('Zhiyuan password session', () => {
  test('coalesces concurrent restoration and returns immutable identity snapshots', async () => {
    let finishRestore: ((tokens: AepTokens) => void) | null = null;
    let signalRestoreStarted: (() => void) | null = null;
    const restoreStarted = new Promise<void>(resolve => {
      signalRestoreStarted = resolve;
    });
    const restoreResult = new Promise<AepTokens>(resolve => {
      finishRestore = resolve;
    });
    const client = mockClient({
      getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'recoverable' })),
      restoreSession: vi.fn(async () => {
        signalRestoreStarted!();
        return restoreResult;
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    const first = session.initialize();
    const second = session.initialize();
    expect(first).toBe(second);
    await restoreStarted;
    finishRestore!(tokens());

    await expect(first).resolves.toMatchObject({ status: 'authenticated' });
    expect(client.getSessionState).toHaveBeenCalledTimes(1);
    expect(client.restoreSession).toHaveBeenCalledTimes(1);
    expect(client.getCurrentIdentity).toHaveBeenCalledTimes(1);

    const snapshot = session.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    if (snapshot.status === 'authenticated') {
      expect(Object.isFrozen(snapshot.identity)).toBe(true);
      expect(Object.isFrozen(snapshot.identity.roles)).toBe(true);
    }
  });

  test('keeps a recoverable state when refresh cannot complete', async () => {
    const client = mockClient({
      getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'recoverable' })),
      restoreSession: vi.fn(async () => {
        throw new Error('service unavailable');
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    await expect(session.initialize()).rejects.toThrow('service unavailable');
    expect(session.snapshot()).toEqual({ status: 'recoverable' });
  });

  test('serializes password login and logout without exposing credentials', async () => {
    let finishLogin: (() => void) | null = null;
    const loginGate = new Promise<void>(resolve => {
      finishLogin = resolve;
    });
    const client = mockClient({
      loginWithPassword: vi.fn(async () => {
        await loginGate;
        return tokens();
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    const login = session.login({
      aepBaseUrl: 'https://aep.example.test',
      username: 'admin',
      password: 'never-persist-this',
    });
    const logout = session.logout();
    expect(client.logout).not.toHaveBeenCalled();

    finishLogin!();
    await expect(login).resolves.toMatchObject({ status: 'authenticated' });
    await expect(logout).resolves.toEqual({ status: 'signed-out' });
    expect(client.loginWithPassword).toHaveBeenCalledWith({
      deploymentId: 'enterprise-1',
      username: 'admin',
      password: 'never-persist-this',
    });
    expect(client.logout).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(session.snapshot())).not.toContain('never-persist-this');
  });

  test('creates the AEP client for the address supplied at login', async () => {
    const initialClient = mockClient();
    const loginClient = mockClient();
    const session = new ZhiyuanPasswordSession(initialClient, baseUrl => {
      expect(baseUrl).toBe('https://aep.customer.example');
      return loginClient;
    });

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.customer.example/',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(initialClient.loginWithPassword).not.toHaveBeenCalled();
    expect(loginClient.loginWithPassword).toHaveBeenCalledOnce();
  });

  test('derives the deployment from server metadata before password login', async () => {
    const client = mockClient({
      getMetadata: vi.fn(async () => {
        const { deploymentId: _deploymentId, ...rest } = metadata();
        return { ...rest, deployment: { id: 'demo', name: 'Zhiyuan Demo' } };
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.example.test',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(client.loginWithPassword).toHaveBeenCalledWith({
      deploymentId: 'demo',
      username: 'admin',
      password: 'secret',
    });
  });

  test('rejects sign-in when server metadata cannot be retrieved', async () => {
    const client = mockClient({
      getMetadata: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.example.test',
        username: 'admin',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(AepMetadataError);
    expect(client.loginWithPassword).not.toHaveBeenCalled();
    expect(session.snapshot()).toEqual({ status: 'signed-out' });
  });

  test('rejects sign-in when server metadata omits the deployment', async () => {
    const client = mockClient({
      getMetadata: vi.fn(async () => {
        const { deploymentId: _deploymentId, ...rest } = metadata();
        return rest;
      }),
    });
    const session = new ZhiyuanPasswordSession(client);

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.example.test',
        username: 'admin',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(AepMetadataError);
    expect(client.loginWithPassword).not.toHaveBeenCalled();
  });

  test('validates password operations before calling the SDK', async () => {
    const client = mockClient();
    const session = new ZhiyuanPasswordSession(client);

    await expect(
      session.login({ aepBaseUrl: 'https://aep.example.test', username: '', password: 'secret' }),
    ).rejects.toThrow('required');
    await expect(session.changePassword('', 'new-secret')).rejects.toThrow('required');
    expect(client.getMetadata).not.toHaveBeenCalled();
    expect(client.loginWithPassword).not.toHaveBeenCalled();
    expect(client.changePassword).not.toHaveBeenCalled();
  });

  test('gates model operations on authentication and publishes session changes', async () => {
    const client = mockClient();
    const session = new ZhiyuanPasswordSession(client);
    const changed = vi.fn();
    const unsubscribe = session.onDidChange(changed);

    await expect(session.listAgentModels()).resolves.toEqual({ models: [] });
    await expect(session.getModelConnection()).rejects.toThrow('not authenticated');
    expect(client.listAgentModels).not.toHaveBeenCalled();

    await session.login({
      aepBaseUrl: 'https://aep.example.test',
      username: 'admin',
      password: 'secret',
    });
    await expect(session.listAgentModels()).resolves.toEqual({ models: [] });
    await expect(session.getModelConnection()).resolves.toMatchObject({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'model-token',
    });
    expect(changed).toHaveBeenCalledOnce();

    unsubscribe();
    await session.logout();
    expect(changed).toHaveBeenCalledOnce();
  });

  test('refreshes a short-lived model token before resolving a gateway connection', async () => {
    const client = mockClient({
      loginWithPassword: vi.fn(async () => ({ ...tokens(), modelAccessExpiresIn: 1 })),
    });
    const session = new ZhiyuanPasswordSession(client);

    await session.login({
      aepBaseUrl: 'https://aep.example.test',
      username: 'admin',
      password: 'secret',
    });
    await session.getModelConnection();

    expect(client.refreshSession).toHaveBeenCalledOnce();
    expect(client.getModelConnection).toHaveBeenCalledOnce();
  });

  test('waits for asynchronous session listeners before completing a transition', async () => {
    const session = new ZhiyuanPasswordSession(mockClient());
    let releaseListener: () => void = () => {};
    const listenerGate = new Promise<void>(resolve => {
      releaseListener = resolve;
    });
    const listener = vi.fn(async () => listenerGate);
    session.onDidChange(listener);

    let completed = false;
    const login = session
      .login({ aepBaseUrl: 'https://aep.example.test', username: 'admin', password: 'secret' })
      .then(() => {
        completed = true;
      });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(completed).toBe(false);

    releaseListener();
    await login;
    expect(completed).toBe(true);
  });
});

function mockClient(overrides: Partial<PasswordSessionClient> = {}): PasswordSessionClient {
  return {
    getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'signed-out' })),
    restoreSession: vi.fn(async () => null),
    refreshSession: vi.fn(async () => tokens()),
    getMetadata: vi.fn(async () => metadata()),
    loginWithPassword: vi.fn(async () => tokens()),
    changePassword: vi.fn(async () => tokens()),
    getCurrentIdentity: vi.fn(async () => identity()),
    listAgentModels: vi.fn(async () => ({ models: [] })),
    getModelConnection: vi.fn(async () => modelConnection()),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

function metadata(): ServiceMetadata {
  return {
    service: 'aep-control-service',
    supportedProtocolVersions: ['1'],
    capabilities: [],
    jwksUri: 'https://aep.example.test/.well-known/jwks.json',
    deploymentId: 'enterprise-1',
  };
}

function modelConnection(): ModelConnection {
  return {
    baseUrl: 'https://gateway.example/v1',
    protocol: 'openai-compatible',
    apiVersion: 'v1',
    apiKey: 'model-token',
    expiresIn: 300,
  };
}

function tokens(): AepTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    modelAccessToken: 'model-token',
    tokenType: 'Bearer',
    expiresIn: 900,
    modelAccessExpiresIn: 300,
    passwordChangeRequired: false,
  };
}

function identity(): CurrentIdentity {
  return {
    user: { id: 'user-1', displayName: 'Administrator' },
    enterprise: { id: 'enterprise-1', name: 'Zhiyuan' },
    roles: ['admin'],
    sessionExpiresAt: '2026-08-24T11:00:00Z',
    passwordChangeRequired: false,
  };
}

describe('agent control endpoint discovery', () => {
  test('discovers metadata from the entered server, not the previously configured one', async () => {
    const initialClient = mockClient();
    const loginClient = mockClient();
    const factoryCalls: Array<{ baseUrl: string; agentControlBaseUrl?: string | undefined }> = [];
    const session = new ZhiyuanPasswordSession(initialClient, (baseUrl, agentControlBaseUrl) => {
      factoryCalls.push({ baseUrl, agentControlBaseUrl });
      return loginClient;
    });

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.customer.example',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(initialClient.getMetadata).not.toHaveBeenCalled();
    expect(loginClient.getMetadata).toHaveBeenCalledOnce();
    expect(factoryCalls).toEqual([
      { baseUrl: 'https://aep.customer.example', agentControlBaseUrl: undefined },
    ]);
  });

  test('targets the advertised agent-control URL when rebuilding at login', async () => {
    const initialClient = mockClient();
    const loginClient = mockClient({
      getMetadata: vi.fn(async () => ({
        ...metadata(),
        agentControl: { baseUrl: 'https://agents.customer.example' },
      })),
    });
    const factoryCalls: Array<{ baseUrl: string; agentControlBaseUrl?: string | undefined }> = [];
    const session = new ZhiyuanPasswordSession(initialClient, (baseUrl, agentControlBaseUrl) => {
      factoryCalls.push({ baseUrl, agentControlBaseUrl });
      return loginClient;
    });

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.customer.example',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(factoryCalls).toEqual([
      { baseUrl: 'https://aep.customer.example', agentControlBaseUrl: undefined },
      {
        baseUrl: 'https://aep.customer.example',
        agentControlBaseUrl: 'https://agents.customer.example',
      },
    ]);
    expect(loginClient.loginWithPassword).toHaveBeenCalledOnce();
  });

  test('keeps the single-base shape when metadata stays silent', async () => {
    const loginClient = mockClient();
    const factoryCalls: Array<{ baseUrl: string; agentControlBaseUrl?: string | undefined }> = [];
    const session = new ZhiyuanPasswordSession(mockClient(), (baseUrl, agentControlBaseUrl) => {
      factoryCalls.push({ baseUrl, agentControlBaseUrl });
      return loginClient;
    });

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.customer.example',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(factoryCalls).toEqual([
      { baseUrl: 'https://aep.customer.example', agentControlBaseUrl: undefined },
    ]);
  });
});
