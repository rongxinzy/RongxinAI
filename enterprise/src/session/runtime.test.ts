import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AepProtectedStorage, CurrentIdentity } from '@aep/sdk-node';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ZhiyuanEnterpriseHostContext } from '../host-contract.js';
import { createZhiyuanSessionRuntime, createZhiyuanSessionRuntimeComponents } from './runtime.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan session runtime', () => {
  test('composes fixed configuration, stable Agent ID, and protected storage', async () => {
    const root = createTemporaryDirectory();
    const context = hostContext(root);
    const configDirectory = path.join(context.paths.resources, 'zhiyuan-enterprise');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        aepBaseUrl: 'http://127.0.0.1:8080',
        allowInsecureHttp: true,
      }),
    );
    const protectedStorage: AepProtectedStorage = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const createProtectedStorage = vi.fn(() => protectedStorage);

    const session = await createZhiyuanSessionRuntime(context, {
      loadSafeStorage: vi.fn(async () => ({
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value: string) => Buffer.from(value),
        decryptString: (value: Buffer) => value.toString('utf8'),
      })),
      createProtectedStorage,
    });

    await expect(session.initialize()).resolves.toEqual({ status: 'signed-out' });
    expect(createProtectedStorage).toHaveBeenCalledWith(
      path.join(context.paths.userData, 'zhiyuan-enterprise', 'secrets'),
      expect.any(Object),
    );
    expect(
      fs.readFileSync(path.join(context.paths.userData, 'zhiyuan-enterprise', 'agent-id'), 'utf8'),
    ).toMatch(/[0-9a-f-]{36}/);
  });

  test('rejects the insecure Linux basic_text storage backend', async () => {
    const root = createTemporaryDirectory();
    const context = hostContext(root, 'linux');
    const configDirectory = path.join(context.paths.resources, 'zhiyuan-enterprise');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        aepBaseUrl: 'http://127.0.0.1:8080',
        allowInsecureHttp: true,
      }),
    );
    const createProtectedStorage = vi.fn();

    await expect(
      createZhiyuanSessionRuntime(context, {
        loadSafeStorage: vi.fn(async () => ({
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => 'basic_text',
          encryptString: (value: string) => Buffer.from(value),
          decryptString: (value: Buffer) => value.toString('utf8'),
        })),
        createProtectedStorage,
      }),
    ).rejects.toThrow('basic_text backend is not permitted');
    expect(createProtectedStorage).not.toHaveBeenCalled();
  });
});

function hostContext(
  root: string,
  platform: NodeJS.Platform = 'win32',
): ZhiyuanEnterpriseHostContext {
  return {
    apiVersion: 1,
    appVersion: '2026.8.0',
    isPackaged: true,
    platform,
    paths: {
      resources: path.join(root, 'resources'),
      userData: path.join(root, 'user-data'),
    },
    capabilities: {
      session: null,
      renderer: null,
      settings: null,
      managedProvider: null,
      skills: null,
    },
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-session-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('agent control endpoint composition', () => {
  test('threads a configured agent control base into every built client', async () => {
    const root = createTemporaryDirectory();
    const context = hostContext(root);
    const configDirectory = path.join(context.paths.resources, 'zhiyuan-enterprise');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        aepBaseUrl: 'http://127.0.0.1:8080',
        allowInsecureHttp: true,
        agentControlBaseUrl: 'http://127.0.0.1:8081',
      }),
    );
    const options: Array<{ baseUrl: string; agentControlBaseUrl?: string }> = [];
    const components = await createZhiyuanSessionRuntimeComponents(context, {
      loadSafeStorage: vi.fn(async () => safeStorageStub()),
      createClient: vi.fn(clientOptions => {
        options.push({
          baseUrl: clientOptions.baseUrl,
          agentControlBaseUrl: clientOptions.agentControlBaseUrl,
        });
        return stubClient() as never;
      }),
    });

    await components.session
      .login({ aepBaseUrl: 'http://127.0.0.1:9090', username: 'u', password: 'p' })
      .catch(() => undefined);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options[0]).toEqual({
      baseUrl: 'http://127.0.0.1:8080',
      agentControlBaseUrl: 'http://127.0.0.1:8081',
    });
    // The login rebuild keeps the configured agent endpoint while switching
    // the API base to the user-supplied address.
    expect(options.at(-1)).toEqual({
      baseUrl: 'http://127.0.0.1:9090',
      agentControlBaseUrl: 'http://127.0.0.1:8081',
    });
  });

  test('login-time discovery re-targets the agent surface', async () => {
    const root = createTemporaryDirectory();
    const context = hostContext(root);
    const configDirectory = path.join(context.paths.resources, 'zhiyuan-enterprise');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        aepBaseUrl: 'http://127.0.0.1:8080',
        allowInsecureHttp: true,
      }),
    );
    const options: Array<{ baseUrl: string; agentControlBaseUrl?: string | undefined }> = [];
    const stub = stubClient({
      getMetadata: async () => ({
        service: 'aep-control-service',
        deploymentId: 'demo',
        agentControl: { baseUrl: 'http://127.0.0.1:8081' },
      }),
    });
    const components = await createZhiyuanSessionRuntimeComponents(context, {
      loadSafeStorage: vi.fn(async () => safeStorageStub()),
      createClient: vi.fn(clientOptions => {
        options.push({
          baseUrl: clientOptions.baseUrl,
          agentControlBaseUrl: clientOptions.agentControlBaseUrl,
        });
        return stub as never;
      }),
    });

    const snapshot = await components.session.login({
      aepBaseUrl: 'http://127.0.0.1:8080',
      username: 'u',
      password: 'p',
    });
    expect(snapshot.status).toBe('authenticated');
    expect(options[0]).toEqual({
      baseUrl: 'http://127.0.0.1:8080',
      agentControlBaseUrl: undefined,
    });
    expect(options.at(-1)?.agentControlBaseUrl).toBe('http://127.0.0.1:8081');
  });
});

function stubClient(overrides: Record<string, unknown> = {}) {
  return {
    getMetadata: async () => ({ service: 'aep-control-service', deploymentId: 'demo' }),
    loginWithPassword: async () => ({
      accessToken: 'a',
      refreshToken: 'r',
      tokenType: 'Bearer',
      expiresIn: 900,
    }),
    getCurrentIdentity: async () => identity(),
    ...overrides,
  };
}

function safeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  };
}

function identity(): CurrentIdentity {
  return {
    id: 'user-1',
    displayName: 'User',
    kind: 'human',
    roles: [],
    permissions: [],
    sessionId: 'session-1',
    deploymentId: 'demo',
    user: { id: 'user-1', displayName: 'User', kind: 'human', teamIds: [] },
    deployment: { id: 'demo', name: 'Demo' },
    enterprise: { id: 'demo', name: 'Demo' },
  } as unknown as CurrentIdentity;
}
