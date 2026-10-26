import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  AepProtectedStorage,
  AepRequest,
  AepResponse,
  AepTokens,
  AepTransport,
  CurrentIdentity,
} from '@aep/sdk-node';
import { afterEach, expect, test, vi } from 'vitest';

import { EnterpriseSessionStatus, type ZhiyuanEnterpriseHostContext } from '../host-contract.js';
import { EnterpriseConnectionConfigStore } from './connection-config.js';
import { createZhiyuanAepClient, type ZhiyuanPasswordSessionOptions } from './factory.js';
import { createZhiyuanSessionRuntimeComponents } from './runtime.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

test('remembers login-time addresses and split endpoints across restarts without persisting passwords', async () => {
  const fixture = await createFixture();
  const first = await fixture.start();
  await expect(first.session.initialize()).resolves.toEqual({
    status: EnterpriseSessionStatus.SignedOut,
    aepBaseUrl: '',
  });
  expect(fixture.createClient).not.toHaveBeenCalled();
  expect(fixture.requests).toHaveLength(0);

  await first.session.login({
    aepBaseUrl: 'https://aep.customer.test/',
    username: 'admin',
    password: 'private-password',
  });
  const config = await new EnterpriseConnectionConfigStore(fixture.context.paths.userData).load();
  expect(config).toMatchObject({
    aepBaseUrl: 'https://aep.customer.test',
    agentControlBaseUrl: 'https://agents.customer.test',
  });
  expect(JSON.stringify(config)).not.toContain('private-password');

  fixture.requests.length = 0;
  const restarted = await fixture.start();
  await expect(restarted.session.initialize()).resolves.toMatchObject({
    status: EnterpriseSessionStatus.Authenticated,
    aepBaseUrl: 'https://aep.customer.test',
  });
  expect(
    fixture.requests
      .filter(request => request.path.includes('/auth/refresh'))
      .every(request => request.base === 'https://agents.customer.test'),
  ).toBe(true);
  expect(fixture.requests.some(request => request.path.includes('/auth/refresh'))).toBe(true);

  await restarted.session.logout();
  const signedOutRestart = await fixture.start();
  await expect(signedOutRestart.session.initialize()).resolves.toEqual({
    status: EnterpriseSessionStatus.SignedOut,
    aepBaseUrl: 'https://aep.customer.test',
  });
});

test('switches deployments without sending old tokens or discovered endpoints to the new server', async () => {
  const fixture = await createFixture();
  const runtime = await fixture.start();
  await runtime.session.login({
    aepBaseUrl: 'https://aep.customer.test',
    username: 'admin',
    password: 'secret',
  });
  fixture.requests.length = 0;
  await runtime.session.login({
    aepBaseUrl: 'http://new.customer.test',
    username: 'admin',
    password: 'secret',
  });
  await runtime.client.getCurrentIdentity();
  expect(fixture.requests.every(request => request.base === 'http://new.customer.test')).toBe(true);
  expect(fixture.requests[0]?.authorization).toBeUndefined();
  const store = new EnterpriseConnectionConfigStore(fixture.context.paths.userData);
  expect(await store.load()).toEqual({
    schemaVersion: 1,
    aepBaseUrl: 'http://new.customer.test',
    allowInsecureHttp: true,
  });
  expect(new Set(fixture.write.mock.calls.map(call => call[0])).size).toBe(2);
});

test('persists an offline server selection and rejects invalid addresses before replacing it', async () => {
  const fixture = await createFixture();
  const runtime = await fixture.start();
  await expect(
    runtime.session.login({
      aepBaseUrl: 'https://offline.customer.test',
      username: 'admin',
      password: 'secret',
    }),
  ).rejects.toThrow('metadata');
  await expect(
    runtime.session.login({
      aepBaseUrl: 'file:///etc/passwd',
      username: 'admin',
      password: 'secret',
    }),
  ).rejects.toThrow('HTTP');
  const restarted = await fixture.start();
  expect(restarted.session.snapshot().aepBaseUrl).toBe('https://offline.customer.test');
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enterprise-connection-'));
  directories.push(root);
  const context: ZhiyuanEnterpriseHostContext = {
    apiVersion: 1,
    appVersion: '1.0.0',
    isPackaged: true,
    platform: 'win32',
    paths: { resources: path.join(root, 'resources'), userData: path.join(root, 'user-data') },
    capabilities: {
      session: null,
      renderer: null,
      settings: null,
      managedProvider: null,
      skills: null,
    },
  };
  await fs.mkdir(path.join(context.paths.resources, 'zhiyuan-enterprise'), { recursive: true });
  await fs.writeFile(
    path.join(context.paths.resources, 'zhiyuan-enterprise/config.json'),
    JSON.stringify({ schemaVersion: 1, aepBaseUrl: '', allowInsecureHttp: true }),
  );
  const secrets = new Map<string, Uint8Array>();
  const write = vi.fn(async (key: string, value: Uint8Array) => {
    secrets.set(key, Uint8Array.from(value));
  });
  const storage: AepProtectedStorage = {
    read: async key => secrets.get(key) ?? null,
    write,
    remove: async key => {
      secrets.delete(key);
    },
  };
  const requests: Array<{ base: string; path: string; authorization: string | undefined }> = [];
  const transport: AepTransport = {
    async request<T>(base: string, request: AepRequest): Promise<AepResponse<T>> {
      requests.push({ base, path: request.path, authorization: request.headers?.Authorization });
      if (base.includes('offline')) throw new Error('offline');
      const data = request.path.endsWith('/metadata')
        ? {
            deploymentId: 'customer',
            ...(base === 'https://aep.customer.test'
              ? { agentControl: { baseUrl: 'https://agents.customer.test' } }
              : {}),
          }
        : request.path.includes('/auth/')
          ? tokens()
          : identity();
      return { status: 200, headers: new Headers(), data: data as T };
    },
  };
  const createClient = vi.fn((options: ZhiyuanPasswordSessionOptions) =>
    createZhiyuanAepClient({ ...options, transport }),
  );
  const start = () =>
    createZhiyuanSessionRuntimeComponents(context, {
      createClient,
      createProtectedStorage: () => storage,
      loadSafeStorage: async () => ({
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: value => Buffer.from(value),
        decryptString: value => value.toString('utf8'),
      }),
    });
  return { context, start, createClient, requests, write };
}

function tokens(): AepTokens {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    modelAccessToken: 'model',
    tokenType: 'Bearer',
    expiresIn: 900,
    modelAccessExpiresIn: 300,
    passwordChangeRequired: false,
  };
}

function identity(): CurrentIdentity {
  return {
    user: { id: 'user', displayName: 'User' },
    enterprise: { id: 'customer', name: 'Customer' },
    roles: [],
    sessionExpiresAt: '2026-12-01T00:00:00Z',
    passwordChangeRequired: false,
  };
}
