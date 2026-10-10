import type {
  AepSessionState,
  AepTokens,
  CurrentIdentity,
  ModelConnection,
  ServiceMetadata,
} from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import { type PasswordSessionClient, ZhiyuanPasswordSession } from './password-session.js';
import { ZhiyuanPasswordSessionProvider } from './provider.js';

describe('Zhiyuan password session provider', () => {
  test('derives the deployment from server metadata and ignores the contract enterprise ID', async () => {
    const client = mockClient();
    const provider = new ZhiyuanPasswordSessionProvider(new ZhiyuanPasswordSession(client));

    await expect(
      provider.login({
        aepBaseUrl: 'https://aep.example.test',
        enterpriseId: 'server-metadata',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(client.loginWithPassword).toHaveBeenCalledWith({
      deploymentId: 'enterprise-1',
      username: 'admin',
      password: 'secret',
    });
  });

  test('surfaces a server metadata failure as a signed-out snapshot', async () => {
    const client = mockClient({
      getMetadata: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });
    const provider = new ZhiyuanPasswordSessionProvider(new ZhiyuanPasswordSession(client));

    await expect(
      provider.login({
        aepBaseUrl: 'https://aep.example.test',
        enterpriseId: 'server-metadata',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toEqual({ status: 'signed-out' });
    expect(client.loginWithPassword).not.toHaveBeenCalled();
  });

  test('propagates credential failures to the host bridge', async () => {
    const client = mockClient({
      loginWithPassword: vi.fn(async () => {
        throw new Error('invalid credentials');
      }),
    });
    const provider = new ZhiyuanPasswordSessionProvider(new ZhiyuanPasswordSession(client));

    await expect(
      provider.login({
        aepBaseUrl: 'https://aep.example.test',
        enterpriseId: 'server-metadata',
        username: 'admin',
        password: 'wrong',
      }),
    ).rejects.toThrow('invalid credentials');
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

function modelConnection(): ModelConnection {
  return {
    baseUrl: 'https://gateway.example/v1',
    protocol: 'openai-compatible',
    apiVersion: 'v1',
    apiKey: 'model-token',
    expiresIn: 300,
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
