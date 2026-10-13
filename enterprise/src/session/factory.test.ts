import type {
  AepProtectedStorage,
  AepRequest,
  AepResponse,
  AepTokens,
  AepTransport,
  CurrentIdentity,
  ServiceMetadata,
} from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import { createZhiyuanAepClient, createZhiyuanPasswordSession } from './factory.js';

describe('Zhiyuan password session factory', () => {
  test('routes agent-surface paths to a configured agent control base', async () => {
    const bases: Array<{ base: string; path: string }> = [];
    const transport = {
      async request<T>(base: string, request: AepRequest): Promise<AepResponse<T>> {
        bases.push({ base, path: request.path });
        const data = request.path.endsWith('/auth/password/login')
          ? tokens()
          : request.path.endsWith('/metadata')
            ? metadata()
            : request.path.endsWith('/heartbeat')
              ? ({ nextHeartbeatAfterSeconds: 30 } as unknown)
              : identity();
        return { status: 200, headers: new Headers(), data: data as T };
      },
    } satisfies AepTransport;
    const protectedStorage = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const client = createZhiyuanAepClient({
      baseUrl: 'https://api.example.test',
      agentControlBaseUrl: 'https://agents.example.test',
      agentId: 'agent-1',
      agentVersion: '2026.8.0',
      platform: 'windows',
      protectedStorage,
      transport,
    });

    await client.getMetadata();
    await client.loginWithPassword({
      deploymentId: 'enterprise-1',
      username: 'admin',
      password: 'secret',
    });
    await client.heartbeatUser({ status: 'online' });

    const byPath = (fragment: string) => bases.find(entry => entry.path.includes(fragment))?.base;
    expect(byPath('/metadata')).toBe('https://api.example.test');
    expect(byPath('/auth/password/login')).toBe('https://agents.example.test');
    expect(byPath('/user/heartbeat')).toBe('https://agents.example.test');
  });

  test('derives a safe refresh-token key for arbitrary protocol agent IDs', async () => {
    const write = vi.fn(async (_key: string, _value: Uint8Array) => undefined);
    const protectedStorage: AepProtectedStorage = {
      read: vi.fn(async () => null),
      write,
      remove: vi.fn(async () => undefined),
    };
    const session = createZhiyuanPasswordSession({
      baseUrl: 'http://127.0.0.1:8080',
      agentId: 'Agent / Customer Device #1',
      agentVersion: '2026.8.0',
      platform: 'windows',
      protectedStorage,
      transport: fixtureTransport(),
    });

    await expect(
      session.login({
        aepBaseUrl: 'https://aep.example.test',
        username: 'admin',
        password: 'secret',
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatch(/^aep\.refresh-token\.[0-9a-f]{64}$/);
  });
});

function fixtureTransport(): AepTransport {
  return {
    async request<T>(_baseUrl: string, request: AepRequest): Promise<AepResponse<T>> {
      const data = request.path.endsWith('/auth/password/login')
        ? tokens()
        : request.path.endsWith('/metadata')
          ? metadata()
          : identity();
      return { status: 200, headers: new Headers(), data: data as T };
    },
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
