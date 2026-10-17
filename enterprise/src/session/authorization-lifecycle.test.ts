import {
  AepCapability,
  AepClient,
  type AepRequest,
  type AepResponse,
  type AepTokens,
  type AepTransport,
  MemoryTokenStore,
} from '@aep/sdk-node';
import { expect, test } from 'vitest';

import { ZhiyuanLicenseActivation } from '../license/activation.js';
import { ZhiyuanModelProvider } from '../models/provider.js';
import { ZhiyuanPasswordSession } from './password-session.js';

test('new grants update both SDK model tokens and unexpired entitlements without relogin', async () => {
  const fixture = await authenticatedFixture();
  const provider = new ZhiyuanModelProvider(fixture.session, {
    requireEntitlement: true,
    getEntitlementToken: () => fixture.activation.entitlement()?.entitlementToken ?? null,
    refreshEntitlement: scopes => fixture.activation.refreshIfNeeded(Date.now(), scopes),
  });
  await provider.snapshot();
  const previousToken = (await fixture.store.get())?.modelAccessToken;
  expect(fixture.activation.entitlement()?.modelScopes).toEqual(['first']);

  fixture.models.push('new-grant');
  const updated = await provider.snapshot();
  expect(updated.models?.map(model => model.id)).toEqual(['first', 'new-grant']);
  expect(updated.apiKey).toBe('fixture-entitlement-first,new-grant');
  expect((await fixture.store.get())?.modelAccessToken).not.toBe(previousToken);
  expect(fixture.activation.entitlement()?.modelScopes).toEqual(['first', 'new-grant']);
  expect(fixture.calls.filter(path => path.endsWith('/login'))).toHaveLength(1);
  expect(fixture.calls.filter(path => path.endsWith('/activation'))).toHaveLength(2);
  const refreshes = fixture.calls.filter(path => path.endsWith('/refresh')).length;
  await provider.snapshot();
  expect(fixture.calls.filter(path => path.endsWith('/activation'))).toHaveLength(2);
  expect(fixture.calls.filter(path => path.endsWith('/refresh'))).toHaveLength(refreshes);
  fixture.activation.stop();
});

test('SDK logout failure clears wrapper state and entitlement and allows a new login', async () => {
  const fixture = await authenticatedFixture();
  fixture.state.logoutFails = true;
  await expect(fixture.session.logout()).rejects.toMatchObject({ status: 503 });
  expect(await fixture.store.get()).toBeNull();
  expect(fixture.session.snapshot().status).toBe('signed-out');
  expect(fixture.activation.entitlement()).toBeNull();
  await fixture.session.login(loginInput());
  expect(fixture.session.snapshot().status).toBe('authenticated');
  fixture.activation.stop();
});

test('SDK terminal refresh rejection clears all enterprise authentication projections', async () => {
  const fixture = await authenticatedFixture();
  fixture.state.refreshFails = true;
  // First catalog read invalidates the model token so the next connection
  // must refresh, even though the original token has not expired.
  await fixture.session.listAgentModels();
  await expect(fixture.session.getModelConnection()).rejects.toMatchObject({ status: 401 });
  expect(await fixture.store.get()).toBeNull();
  expect(fixture.session.snapshot().status).toBe('signed-out');
  expect(fixture.activation.entitlement()).toBeNull();
  fixture.state.refreshFails = false;
  await fixture.session.login(loginInput());
  await expect(fixture.session.getModelConnection()).resolves.toHaveProperty('apiKey');
  fixture.activation.stop();
});

test('activation auto-refresh rejection also synchronizes the enterprise login state', async () => {
  const fixture = await authenticatedFixture();
  // A 401 on activation triggers the SDK's automatic token refresh.
  fixture.state.activationUnauthorized = true;
  fixture.state.refreshFails = true;
  await expect(fixture.activation.activate()).resolves.toBeNull();
  expect(await fixture.store.get()).toBeNull();
  expect(fixture.session.snapshot().status).toBe('signed-out');
  expect(fixture.activation.entitlement()).toBeNull();
  fixture.activation.stop();
});

async function authenticatedFixture() {
  const models = ['first'];
  const calls: string[] = [];
  const state = { logoutFails: false, refreshFails: false, activationUnauthorized: false };
  let sequence = 0;
  const store = new MemoryTokenStore();
  const transport: AepTransport = {
    async request<T>(_base: string, request: AepRequest): Promise<AepResponse<T>> {
      calls.push(request.path);
      let data: unknown;
      let status = 200;
      switch (request.path) {
        case '/aep/v1/metadata':
          data = {
            deploymentId: 'fixture',
            capabilities: [AepCapability.ModelGateway],
            modelGateway: {
              baseUrl: 'https://gateway.example.test/v1',
              protocol: 'openai-compatible',
              apiVersion: 'v1',
            },
          };
          break;
        case '/aep/v1/auth/password/login':
        case '/aep/v1/auth/refresh':
          if (request.path.endsWith('/refresh') && state.refreshFails) {
            status = 401;
            data = { title: 'Session revoked', code: 'REFRESH_TOKEN_INVALID' };
          } else {
            sequence++;
            data = {
              accessToken: `fixture-access-${sequence}`,
              refreshToken: `fixture-refresh-${sequence}`,
              modelAccessToken: `fixture-model-${sequence}-${models.join(',')}`,
              tokenType: 'Bearer',
              expiresIn: 3600,
              modelAccessExpiresIn: 3600,
              passwordChangeRequired: false,
            } satisfies AepTokens;
          }
          break;
        case '/aep/v1/user/me':
          data = { user: { id: 'fixture' }, enterprise: { id: 'fixture' }, roles: [] };
          break;
        case '/aep/v1/user/models':
          data = {
            models: models.map(id => ({
              id,
              displayName: id,
              sourceType: 'gateway',
              protocol: 'openai-compatible',
              capabilities: ['text'],
              enabled: true,
              isDefault: false,
            })),
          };
          break;
        case '/aep/v1/user/activation':
          if (state.activationUnauthorized) {
            status = 401;
            data = { title: 'Access token invalid' };
            break;
          }
          data = {
            entitlementToken: `fixture-entitlement-${models.join(',')}`,
            tokenType: 'Bearer',
            expiresAt: '2099-01-01T00:00:00.000Z',
            expiresIn: 86400,
            licenseId: 'fixture',
            licenseDigest: 'fixture',
            deploymentId: 'fixture',
            features: ['enterprise.models'],
            modelScopes: [...models],
          };
          break;
        case '/aep/v1/auth/logout':
          status = state.logoutFails ? 503 : 204;
          data = { title: 'Service unavailable' };
          break;
        default:
          throw new Error(`Unexpected fixture request: ${request.path}`);
      }
      return { status, headers: new Headers(), data: data as T };
    },
  };
  const client = new AepClient({
    baseUrl: 'https://aep.example.test',
    tokenStore: store,
    transport,
  });
  const session = new ZhiyuanPasswordSession(client);
  const activation = ZhiyuanLicenseActivation.create({ session, client: session });
  activation.start();
  await session.login(loginInput());
  await activation.refreshIfNeeded();
  return { models, calls, state, store, session, activation };
}

function loginInput() {
  return {
    aepBaseUrl: 'https://aep.example.test',
    username: 'fixture',
    password: 'fixture-password',
  };
}
