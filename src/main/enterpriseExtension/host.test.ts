import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
  ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION,
  ZhiyuanEnterpriseExtensionStatus,
  type ZhiyuanEnterpriseHostContext,
} from './contract';
import { ZhiyuanEnterpriseExtensionHost, type ZhiyuanEnterpriseExtensionHostOptions } from './host';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan enterprise extension host', () => {
  test('keeps community startup unchanged when no extension is packaged', async () => {
    const importModule = vi.fn();
    const host = new ZhiyuanEnterpriseExtensionHost(importModule);

    await expect(host.initialize(options())).resolves.toEqual({
      status: ZhiyuanEnterpriseExtensionStatus.Absent,
      extensionId: null,
    });
    expect(importModule).not.toHaveBeenCalled();
  });

  test('loads the fixed packaged module and passes frozen host context', async () => {
    const root = createTemporaryDirectory();
    const modulePath = path.join(root, 'resources', 'zhiyuan-enterprise', 'extension.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module placeholder');
    let receivedContext: ZhiyuanEnterpriseHostContext | null = null;
    const dispose = vi.fn(async () => undefined);
    const host = new ZhiyuanEnterpriseExtensionHost(async importedPath => {
      expect(importedPath).toBe(modulePath);
      return {
        createZhiyuanEnterpriseExtension: () => ({
          apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
          id: 'zhiyuan.aaas',
          initialize: async (context: ZhiyuanEnterpriseHostContext) => {
            receivedContext = context;
          },
          dispose,
        }),
      };
    });

    await expect(host.initialize(options(root, true))).resolves.toEqual({
      status: ZhiyuanEnterpriseExtensionStatus.Active,
      extensionId: 'zhiyuan.aaas',
    });
    expect(receivedContext).toMatchObject({
      apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
      appVersion: '2026.8.0',
      isPackaged: true,
      platform: process.platform,
    });
    expect(Object.isFrozen(receivedContext)).toBe(true);
    expect(Object.isFrozen(receivedContext!.paths)).toBe(true);
    expect(Object.isFrozen(receivedContext!.capabilities)).toBe(true);
    expect(receivedContext!.capabilities.session).toBeNull();

    await host.dispose();
    await host.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('allows an absolute development module without changing packaged resolution', async () => {
    const root = createTemporaryDirectory();
    const developmentModule = path.join(root, 'private-extension.cjs');
    fs.writeFileSync(developmentModule, 'module placeholder');
    const importModule = vi.fn(async () => validModule());
    const host = new ZhiyuanEnterpriseExtensionHost(importModule);

    await host.initialize(options(root, false, developmentModule));
    expect(importModule).toHaveBeenCalledWith(developmentModule);

    const packagedHost = new ZhiyuanEnterpriseExtensionHost(importModule);
    await packagedHost.initialize(options(root, true, developmentModule));
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  test('passes the versioned session capability to the extension', async () => {
    const root = createTemporaryDirectory();
    const modulePath = path.join(root, 'resources', 'zhiyuan-enterprise', 'extension.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module placeholder');
    const registerProvider = vi.fn();
    const sessionCapability = {
      apiVersion: ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION,
      registerProvider,
    };
    let receivedContext: ZhiyuanEnterpriseHostContext | null = null;
    const host = new ZhiyuanEnterpriseExtensionHost(async () => ({
      createZhiyuanEnterpriseExtension: () => ({
        ...validExtension(),
        initialize: async (context: ZhiyuanEnterpriseHostContext) => {
          receivedContext = context;
        },
      }),
    }));

    await host.initialize({ ...options(root, true), sessionCapability });

    expect(receivedContext!.capabilities.session).toBe(sessionCapability);
    expect(receivedContext!.capabilities.session?.apiVersion).toBe(1);
  });

  test('imports a real CommonJS development bundle', async () => {
    const root = createTemporaryDirectory();
    const developmentModule = path.join(root, 'private-extension.cjs');
    fs.writeFileSync(
      developmentModule,
      'module.exports.createZhiyuanEnterpriseExtension = () => ({\n' +
        '  apiVersion: 1,\n' +
        "  id: 'zhiyuan.fixture',\n" +
        "  initialize: async context => { if (!Object.isFrozen(context)) throw new Error('context is mutable'); },\n" +
        '  dispose: async () => undefined,\n' +
        '});\n',
    );
    const host = new ZhiyuanEnterpriseExtensionHost();

    await expect(host.initialize(options(root, false, developmentModule))).resolves.toEqual({
      status: ZhiyuanEnterpriseExtensionStatus.Active,
      extensionId: 'zhiyuan.fixture',
    });
    await host.dispose();
  });

  test('rejects relative development paths and incompatible extensions', async () => {
    const host = new ZhiyuanEnterpriseExtensionHost(async () => validModule());
    await expect(host.initialize(options(undefined, false, 'relative.cjs'))).rejects.toThrow(
      'must be absolute',
    );

    const root = createTemporaryDirectory();
    const modulePath = path.join(root, 'resources', 'zhiyuan-enterprise', 'extension.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module placeholder');
    const incompatibleHost = new ZhiyuanEnterpriseExtensionHost(async () => ({
      createZhiyuanEnterpriseExtension: () => ({
        ...validExtension(),
        apiVersion: 2,
      }),
    }));
    await expect(incompatibleHost.initialize(options(root, true))).rejects.toThrow(
      'API version is not supported',
    );
    expect(incompatibleHost.snapshot().status).toBe(ZhiyuanEnterpriseExtensionStatus.Failed);
  });

  test('cleans up a partially initialized extension and preserves both failures', async () => {
    const root = createTemporaryDirectory();
    const modulePath = path.join(root, 'resources', 'zhiyuan-enterprise', 'extension.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module placeholder');
    const host = new ZhiyuanEnterpriseExtensionHost(async () => ({
      createZhiyuanEnterpriseExtension: () => ({
        ...validExtension(),
        initialize: async () => {
          throw new Error('initialization failed');
        },
        dispose: async () => {
          throw new Error('cleanup failed');
        },
      }),
    }));

    await expect(host.initialize(options(root, true))).rejects.toBeInstanceOf(AggregateError);
    expect(host.snapshot().status).toBe(ZhiyuanEnterpriseExtensionStatus.Failed);
  });

  test('waits for in-flight initialization before disposing', async () => {
    const root = createTemporaryDirectory();
    const modulePath = path.join(root, 'resources', 'zhiyuan-enterprise', 'extension.cjs');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, 'module placeholder');
    let finishInitialization: (() => void) | null = null;
    let signalInitializationStarted: (() => void) | null = null;
    const initializationStarted = new Promise<void>(resolve => {
      signalInitializationStarted = resolve;
    });
    const dispose = vi.fn(async () => undefined);
    const host = new ZhiyuanEnterpriseExtensionHost(async () => ({
      createZhiyuanEnterpriseExtension: () => ({
        ...validExtension(),
        initialize: () =>
          new Promise<void>(resolve => {
            finishInitialization = resolve;
            signalInitializationStarted!();
          }),
        dispose,
      }),
    }));

    const initializing = host.initialize(options(root, true));
    await initializationStarted;
    const disposing = host.dispose();
    finishInitialization!();

    await initializing;
    await disposing;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.snapshot()).toEqual({
      status: ZhiyuanEnterpriseExtensionStatus.Disposed,
      extensionId: null,
    });
  });
});

function options(
  root = createTemporaryDirectory(),
  isPackaged = true,
  developmentExtensionPath?: string,
): ZhiyuanEnterpriseExtensionHostOptions {
  return {
    appVersion: '2026.8.0',
    isPackaged,
    platform: process.platform,
    resourcesPath: path.join(root, 'resources'),
    userDataPath: path.join(root, 'user-data'),
    developmentExtensionPath,
  };
}

function validModule() {
  return { createZhiyuanEnterpriseExtension: () => validExtension() };
}

function validExtension() {
  return {
    apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
    id: 'zhiyuan.aaas',
    initialize: async () => undefined,
    dispose: async () => undefined,
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-enterprise-host-'));
  temporaryDirectories.push(directory);
  return directory;
}
