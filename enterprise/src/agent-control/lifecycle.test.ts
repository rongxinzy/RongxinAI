import type { AepSessionState } from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import { ZhiyuanPasswordSession } from '../session/password-session.js';
import { ZhiyuanAgentControlLifecycle } from './lifecycle.js';

describe('Zhiyuan Agent control lifecycle', () => {
  test('starts after login, waits for stop on logout, and closes on disposal', async () => {
    const session = new ZhiyuanPasswordSession(clientFixture());
    let releaseStop: () => void = () => {};
    const stopGate = new Promise<void>(resolve => {
      releaseStop = resolve;
    });
    const backend = {
      start: vi.fn(),
      stop: vi.fn(async () => stopGate),
      close: vi.fn(async () => undefined),
    };
    const lifecycle = new ZhiyuanAgentControlLifecycle(session, backend);

    await session.login({
      aepBaseUrl: 'https://aep.example.test',
      username: 'admin',
      password: 'secret',
    });
    expect(backend.start).toHaveBeenCalledOnce();

    let loggedOut = false;
    const logout = session.logout().then(() => {
      loggedOut = true;
    });
    await vi.waitFor(() => expect(backend.stop).toHaveBeenCalledOnce());
    expect(loggedOut).toBe(false);
    releaseStop();
    await logout;

    await lifecycle.dispose();
    await lifecycle.dispose();
    expect(backend.close).toHaveBeenCalledOnce();
  });
});

function clientFixture(): ConstructorParameters<typeof ZhiyuanPasswordSession>[0] {
  return {
    getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'signed-out' })),
    restoreSession: vi.fn(async () => null),
    refreshSession: vi.fn(),
    getMetadata: vi.fn(async () => ({
      service: 'aep-control-service',
      supportedProtocolVersions: ['1'],
      capabilities: [],
      jwksUri: 'https://aep.example.test/.well-known/jwks.json',
      deploymentId: 'enterprise-1',
    })),
    loginWithPassword: vi.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      modelAccessToken: 'model-token',
      tokenType: 'Bearer' as const,
      expiresIn: 900,
      modelAccessExpiresIn: 300,
      passwordChangeRequired: false,
    })),
    changePassword: vi.fn(),
    getCurrentIdentity: vi.fn(async () => ({
      user: { id: 'user-1', displayName: 'Administrator' },
      enterprise: { id: 'enterprise-1', name: 'Zhiyuan' },
      roles: ['admin'],
      sessionExpiresAt: '2026-08-26T12:00:00.000Z',
      passwordChangeRequired: false,
    })),
    listAgentModels: vi.fn(async () => ({ models: [] })),
    getModelConnection: vi.fn(),
    logout: vi.fn(async () => undefined),
  };
}
