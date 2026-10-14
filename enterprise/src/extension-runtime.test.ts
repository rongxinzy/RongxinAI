import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AepProtectedStorage } from '@aep/sdk-node';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ZhiyuanAgentControlBackendOptions } from './agent-control/factory.js';
import { createZhiyuanExtensionRuntime } from './extension-runtime.js';
import type { ZhiyuanEnterpriseHostContext } from './host-contract.js';
import { createZhiyuanAepClient, type ZhiyuanPasswordSessionOptions } from './session/factory.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan extension runtime', () => {
  test('shares the session client with Agent control and releases the managed root', async () => {
    const root = createTemporaryDirectory();
    const managedRoot = path.join(root, 'managed-skills');
    writeConfig(root);
    const unregister = vi.fn();
    const notifyChanged = vi.fn();
    const context = hostContext(root, {
      apiVersion: 1,
      registerManagedRoot: vi.fn(() => ({
        directory: managedRoot,
        notifyChanged,
        unregister,
      })),
    });
    const clientFactory = vi.fn((options: ZhiyuanPasswordSessionOptions) =>
      createZhiyuanAepClient(options),
    );
    const backend = {
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const createBackend = vi.fn((_options: ZhiyuanAgentControlBackendOptions) => backend);
    const protectedStorage: AepProtectedStorage = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };

    const runtime = await createZhiyuanExtensionRuntime(context, {
      loadSafeStorage: vi.fn(async () => safeStorageFixture()),
      createProtectedStorage: vi.fn(() => protectedStorage),
      createClient: clientFactory,
      createAgentControlBackend: createBackend,
    });

    expect(createBackend).toHaveBeenCalledOnce();
    const client = clientFactory.mock.results[0]?.value;
    const backendOptions = createBackend.mock.calls[0]?.[0];
    expect(backendOptions?.client).toBe(client);
    expect(backendOptions?.skillRoot).toBe(managedRoot);
    expect(backendOptions?.databasePath).toBe(
      path.join(context.paths.userData, 'zhiyuan-enterprise', 'agent-control.sqlite'),
    );
    backendOptions?.onSkillsChanged?.();
    expect(notifyChanged).toHaveBeenCalledOnce();

    await expect(runtime.session.initialize()).resolves.toEqual({ status: 'signed-out' });
    expect(backend.stop).toHaveBeenCalledOnce();
    await runtime.dispose();
    await runtime.dispose();
    expect(backend.close).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
  });
});

function hostContext(
  root: string,
  skills: ZhiyuanEnterpriseHostContext['capabilities']['skills'],
): ZhiyuanEnterpriseHostContext {
  return {
    apiVersion: 1,
    appVersion: '2026.8.0',
    isPackaged: false,
    platform: 'win32',
    paths: {
      resources: path.join(root, 'resources'),
      userData: path.join(root, 'user-data'),
    },
    capabilities: {
      session: null,
      renderer: null,
      settings: null,
      managedProvider: null,
      skills,
    },
  };
}

function writeConfig(root: string): void {
  const directory = path.join(root, 'resources', 'zhiyuan-enterprise');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'config.json'),
    JSON.stringify({
      schemaVersion: 1,
      aepBaseUrl: 'http://127.0.0.1:8080',
      allowInsecureHttp: true,
    }),
  );
}

function safeStorageFixture() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-extension-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
}
