import type { AepSessionState } from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import {
  createZhiyuanEnterpriseExtension,
  ZHIYUAN_ENTERPRISE_EXTENSION_ID,
  ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT,
  ZHIYUAN_ENTERPRISE_SETTINGS_ENTRYPOINT,
  ZHIYUAN_ENTERPRISE_SETTINGS_PAGES,
  ZhiyuanAaaSExtension,
} from './extension.js';
import {
  ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
  type ZhiyuanEnterpriseHostContext,
  type ZhiyuanEnterpriseSessionProvider,
  type ZhiyuanManagedProviderSource,
} from './host-contract.js';
import { ZhiyuanPasswordSession } from './session/password-session.js';

describe('Zhiyuan enterprise extension contract', () => {
  test('exports the API v1 factory expected by the public host', async () => {
    const extension = createZhiyuanEnterpriseExtension();
    const context = hostContext();

    expect(extension.apiVersion).toBe(ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION);
    expect(extension.id).toBe(ZHIYUAN_ENTERPRISE_EXTENSION_ID);
    await expect(extension.initialize(context)).resolves.toBeUndefined();
    await expect(extension.dispose()).resolves.toBeUndefined();
  });

  test('rejects incompatible hosts and duplicate initialization', async () => {
    const incompatible = createZhiyuanEnterpriseExtension();
    await expect(
      incompatible.initialize({ ...hostContext(), apiVersion: 2 } as never),
    ).rejects.toThrow('API version is not supported');

    const extension = createZhiyuanEnterpriseExtension();
    await extension.initialize(hostContext());
    await expect(extension.initialize(hostContext())).rejects.toThrow(
      'cannot initialize from active',
    );
  });

  test('registers the password provider and unregisters it during disposal', async () => {
    const unregister = vi.fn();
    const registerProvider = vi.fn((_provider: ZhiyuanEnterpriseSessionProvider) => unregister);
    const session = passwordSession();
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn: vi.fn(),
    });

    await extension.initialize(
      hostContext({
        apiVersion: 1,
        registerProvider,
      }),
    );

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const provider = registerProvider.mock.calls[0]?.[0];
    expect(await provider?.snapshot()).toEqual({ status: 'signed-out' });

    await extension.dispose();
    await extension.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  test('disposes the composed runtime with the extension', async () => {
    const disposeRuntime = vi.fn(async () => undefined);
    const extension = new ZhiyuanAaaSExtension({
      createRuntime: vi.fn(async () => ({
        session: passwordSession(),
        dispose: disposeRuntime,
      })),
      warn: vi.fn(),
    });

    await extension.initialize(
      hostContext({ apiVersion: 1, registerProvider: vi.fn(() => vi.fn()) }),
    );
    await extension.dispose();
    await extension.dispose();

    expect(disposeRuntime).toHaveBeenCalledOnce();
  });

  test('keeps the provider available when startup restoration is deferred', async () => {
    const registerProvider = vi.fn((_provider: ZhiyuanEnterpriseSessionProvider) => vi.fn());
    const warn = vi.fn();
    const session = passwordSession({
      getSessionState: vi.fn(async () => {
        throw new Error('service unavailable');
      }),
    });
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn,
    });

    await expect(
      extension.initialize(hostContext({ apiVersion: 1, registerProvider })),
    ).resolves.toBeUndefined();
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[EnterpriseSession] Session restoration could not complete and remains retryable.',
    );
  });

  test('registers the renderer session gate and releases it during disposal', async () => {
    const unregister = vi.fn();
    const registerSessionGate = vi.fn(() => unregister);
    const extension = createZhiyuanEnterpriseExtension();

    await extension.initialize(
      hostContext(null, {
        apiVersion: 1,
        registerSessionGate,
      }),
    );

    expect(registerSessionGate).toHaveBeenCalledWith(ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT);
    await extension.dispose();
    await extension.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  test('registers separate enterprise account and model pages and releases them', async () => {
    const unregister = vi.fn();
    const registerPage = vi.fn(() => unregister);
    const extension = createZhiyuanEnterpriseExtension();

    await extension.initialize(
      hostContext(null, null, {
        apiVersion: 1,
        registerPage,
      }),
    );

    expect(registerPage).toHaveBeenCalledTimes(2);
    expect(registerPage).toHaveBeenNthCalledWith(1, ZHIYUAN_ENTERPRISE_SETTINGS_PAGES[0]);
    expect(registerPage).toHaveBeenNthCalledWith(2, ZHIYUAN_ENTERPRISE_SETTINGS_PAGES[1]);
    expect(
      ZHIYUAN_ENTERPRISE_SETTINGS_PAGES.every(
        page => page.entrypoint === ZHIYUAN_ENTERPRISE_SETTINGS_ENTRYPOINT,
      ),
    ).toBe(true);
    await extension.dispose();
    await extension.dispose();
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  test('rolls back the first settings page when the second registration fails', async () => {
    const unregisterAccount = vi.fn();
    const registerPage = vi
      .fn()
      .mockReturnValueOnce(unregisterAccount)
      .mockImplementationOnce(() => {
        throw new Error('duplicate models page');
      });
    const extension = createZhiyuanEnterpriseExtension();

    await expect(
      extension.initialize(hostContext(null, null, { apiVersion: 1, registerPage })),
    ).rejects.toThrow('duplicate models page');
    expect(unregisterAccount).toHaveBeenCalledOnce();
  });

  test('registers the AEP managed provider source and releases it during disposal', async () => {
    const unregister = vi.fn();
    const registerSource = vi.fn((_provider: ZhiyuanManagedProviderSource) => unregister);
    const session = passwordSession();
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn: vi.fn(),
    });

    await extension.initialize(
      hostContext(null, null, null, {
        apiVersion: 1,
        registerSource,
      }),
    );

    expect(registerSource).toHaveBeenCalledOnce();
    const provider = registerSource.mock.calls[0]?.[0];
    expect(provider?.providerKey).toBe('custom_enterprise');
    expect(provider?.exclusive).toBe(true);
    expect(provider?.snapshot).toEqual(expect.any(Function));

    await extension.dispose();
    await extension.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });

  test('fails closed for an incompatible session capability', async () => {
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => passwordSession()),
      warn: vi.fn(),
    });

    await expect(
      extension.initialize(
        hostContext({
          apiVersion: 2,
          registerProvider: vi.fn(),
        } as never),
      ),
    ).rejects.toThrow('session capability API version is not supported');
  });

  test('fails closed for an incompatible renderer capability', async () => {
    const extension = createZhiyuanEnterpriseExtension();

    await expect(
      extension.initialize(
        hostContext(null, {
          apiVersion: 2,
          registerSessionGate: vi.fn(),
        } as never),
      ),
    ).rejects.toThrow('renderer capability API version is not supported');
  });

  test('fails closed for an incompatible settings capability', async () => {
    const extension = createZhiyuanEnterpriseExtension();
    const registerSessionGate = vi.fn();

    await expect(
      extension.initialize(
        hostContext(null, { apiVersion: 1, registerSessionGate }, {
          apiVersion: 2,
          registerPage: vi.fn(),
        } as never),
      ),
    ).rejects.toThrow('settings capability API version is not supported');
    expect(registerSessionGate).not.toHaveBeenCalled();
  });

  test('fails closed for a managed provider capability below the supported version', async () => {
    const extension = createZhiyuanEnterpriseExtension();

    await expect(
      extension.initialize(
        hostContext(null, null, null, {
          apiVersion: 0,
          registerSource: vi.fn(),
        } as never),
      ),
    ).rejects.toThrow('managed provider capability API version is not supported');
  });

  test('accepts the managed provider capability v2 and registers the source', async () => {
    const unregister = vi.fn();
    const registerSource = vi.fn((_provider: ZhiyuanManagedProviderSource) => unregister);
    const session = passwordSession();
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn: vi.fn(),
    });

    await expect(
      extension.initialize(
        hostContext(null, null, null, {
          apiVersion: 2,
          registerSource,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(registerSource).toHaveBeenCalledOnce();
    expect(registerSource.mock.calls[0]?.[0]?.providerKey).toBe('custom_enterprise');

    await extension.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });

  test('fails closed for an incompatible managed Skill capability', async () => {
    const extension = createZhiyuanEnterpriseExtension();

    await expect(
      extension.initialize(
        hostContext(null, null, null, null, {
          apiVersion: 2,
          registerManagedRoot: vi.fn(),
        } as never),
      ),
    ).rejects.toThrow('Skill capability API version is not supported');
  });
});

function hostContext(
  session: ZhiyuanEnterpriseHostContext['capabilities']['session'] = null,
  renderer: ZhiyuanEnterpriseHostContext['capabilities']['renderer'] = null,
  settings: ZhiyuanEnterpriseHostContext['capabilities']['settings'] = null,
  managedProvider: ZhiyuanEnterpriseHostContext['capabilities']['managedProvider'] = null,
  skills: ZhiyuanEnterpriseHostContext['capabilities']['skills'] = null,
): ZhiyuanEnterpriseHostContext {
  return Object.freeze({
    apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
    appVersion: '2026.8.0',
    isPackaged: false,
    platform: process.platform,
    paths: Object.freeze({
      resources: 'D:\\zhiyuan\\resources',
      userData: 'D:\\zhiyuan\\user-data',
    }),
    capabilities: Object.freeze({ session, renderer, settings, managedProvider, skills }),
  });
}

function passwordSession(
  overrides: Partial<ConstructorParameters<typeof ZhiyuanPasswordSession>[0]> = {},
): ZhiyuanPasswordSession {
  return new ZhiyuanPasswordSession({
    getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'signed-out' })),
    restoreSession: vi.fn(async () => null),
    refreshSession: vi.fn(),
    getMetadata: vi.fn(),
    loginWithPassword: vi.fn(),
    changePassword: vi.fn(),
    getCurrentIdentity: vi.fn(),
    listAgentModels: vi.fn(async () => ({ models: [] })),
    getModelConnection: vi.fn(async () => ({
      baseUrl: 'https://gateway.example/v1',
      protocol: 'openai-compatible' as const,
      apiVersion: 'v1' as const,
      apiKey: 'model-token',
      expiresIn: 300,
    })),
    logout: vi.fn(async () => undefined),
    ...overrides,
  });
}
