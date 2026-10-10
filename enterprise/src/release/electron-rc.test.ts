import type {
  AepSessionState,
  AepTokens,
  AgentModel,
  CurrentIdentity,
  ModelConnection,
  ServiceMetadata,
} from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import {
  ZHIYUAN_ENTERPRISE_EXTENSION_ID,
  ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT,
  ZHIYUAN_ENTERPRISE_SETTINGS_PAGES,
  ZhiyuanAaaSExtension,
} from '../extension.js';
import {
  ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
  type ZhiyuanEnterpriseHostContext,
  type ZhiyuanEnterpriseSessionProvider,
  type ZhiyuanManagedProviderSource,
} from '../host-contract.js';
import { type PasswordSessionClient, ZhiyuanPasswordSession } from '../session/password-session.js';

describe('Electron release candidate contract', () => {
  test('registers an isolated enterprise session and exclusive managed model source', async () => {
    const client = mockClient();
    const session = new ZhiyuanPasswordSession(client);
    const sessionProviders: ZhiyuanEnterpriseSessionProvider[] = [];
    const managedSources: ZhiyuanManagedProviderSource[] = [];
    const registeredPages: unknown[] = [];
    const registeredGates: string[] = [];
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn: vi.fn(),
    });

    await extension.initialize(
      hostContext({
        session: {
          apiVersion: 1,
          registerProvider: (provider) => {
            sessionProviders.push(provider);
            return () => undefined;
          },
        },
        renderer: {
          apiVersion: 1,
          registerSessionGate: (entrypoint) => {
            registeredGates.push(entrypoint);
            return () => undefined;
          },
        },
        settings: {
          apiVersion: 1,
          registerPage: (page) => {
            registeredPages.push(page);
            return () => undefined;
          },
        },
        managedProvider: {
          apiVersion: 1,
          registerSource: (source) => {
            managedSources.push(source);
            return () => undefined;
          },
        },
      }),
    );

    expect(extension.id).toBe(ZHIYUAN_ENTERPRISE_EXTENSION_ID);
    expect(sessionProviders).toHaveLength(1);
    expect(registeredGates).toEqual([ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT]);
    expect(registeredPages).toEqual(ZHIYUAN_ENTERPRISE_SETTINGS_PAGES);
    expect(managedSources).toHaveLength(1);
    expect(managedSources[0]?.exclusive).toBe(true);

    const provider = sessionProviders[0];
    const managed = managedSources[0];
    expect(provider).toBeDefined();
    expect(managed).toBeDefined();
    expect(await provider!.snapshot()).toEqual({ status: 'signed-out' });

    await provider!.login({
      aepBaseUrl: 'https://aep.example.test',
      enterpriseId: 'demo',
      username: 'agent-user',
      password: 'password',
    });
    const snapshot = await managed!.snapshot();

    expect(snapshot).toMatchObject({
      enabled: true,
      userEnabled: true,
      apiKey: 'model-access-token',
      baseUrl: 'https://gateway.example/v1',
      apiFormat: 'openai',
      displayName: 'Zhiyuan',
    });
    expect(snapshot.models).toEqual([
      expect.objectContaining({
        id: 'enterprise-chat',
        name: 'Enterprise Chat',
        capabilities: { toolCalling: 'supported', reasoning: 'supported' },
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('provider-secret');
    expect(JSON.stringify(snapshot)).not.toContain('password');

    await extension.dispose();
  });

  test('fails closed when the control-plane model connection is not OpenAI-compatible', async () => {
    const session = new ZhiyuanPasswordSession(
      mockClient({
        getModelConnection: vi.fn(async () => ({
          ...connection(),
          protocol: 'anthropic-compatible' as never,
        })),
      }),
    );
    await session.login({ aepBaseUrl: 'https://aep.example.test', username: 'agent-user', password: 'password' });
    const extension = new ZhiyuanAaaSExtension({
      createSession: vi.fn(async () => session),
      warn: vi.fn(),
    });
    const source = await sourceFrom(extension);

    await expect(source.snapshot()).rejects.toThrow('protocol is not supported');
    await extension.dispose();
  });
});

async function sourceFrom(extension: ZhiyuanAaaSExtension): Promise<ZhiyuanManagedProviderSource> {
  let source: ZhiyuanManagedProviderSource | undefined;
  await extension.initialize(
    hostContext({
      managedProvider: {
        apiVersion: 1,
        registerSource: (value) => {
          source = value;
          return () => undefined;
        },
      },
    }),
  );
  if (!source) throw new Error('Managed provider source was not registered.');
  return source;
}

function hostContext(
  capabilities: Partial<ZhiyuanEnterpriseHostContext['capabilities']> = {},
): ZhiyuanEnterpriseHostContext {
  return {
    apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
    appVersion: '2026.9.0-rc.1',
    isPackaged: true,
    platform: 'linux',
    paths: { resources: '/opt/zhiyuan/resources', userData: '/tmp/zhiyuan-user-data' },
    capabilities: {
      session: null,
      renderer: null,
      settings: null,
      managedProvider: null,
      skills: null,
      ...capabilities,
    },
  };
}

function mockClient(overrides: Partial<PasswordSessionClient> = {}): PasswordSessionClient {
  return {
    getSessionState: vi.fn(async (): Promise<AepSessionState> => ({ status: 'signed-out' })),
    restoreSession: vi.fn(async () => null),
    refreshSession: vi.fn(async () => tokens()),
    getMetadata: vi.fn(async () => metadata()),
    loginWithPassword: vi.fn(async () => tokens()),
    changePassword: vi.fn(async () => tokens()),
    getCurrentIdentity: vi.fn(async () => identity()),
    listAgentModels: vi.fn(async () => ({
      models: [
        model(),
        model({ id: 'disabled', displayName: 'Disabled', enabled: false }),
        model({ id: 'local', displayName: 'Local', sourceType: 'local' }),
      ],
    })),
    getModelConnection: vi.fn(async () => connection()),
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
    deploymentId: 'demo',
  };
}

function model(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    id: 'enterprise-chat',
    displayName: 'Enterprise Chat',
    sourceType: 'gateway',
    protocol: 'openai-compatible',
    capabilities: ['text', 'streaming', 'tools', 'reasoning'],
    reasoningCompatibility: {
      thinkingFormat: 'deepseek',
      supportsReasoningEffort: true,
      requiresReasoningContentOnAssistantMessages: true,
    },
    isDefault: true,
    enabled: true,
    ...overrides,
  } as AgentModel;
}

function connection(): ModelConnection {
  return {
    baseUrl: 'https://gateway.example/v1',
    protocol: 'openai-compatible',
    apiVersion: 'v1',
    apiKey: 'model-access-token',
    expiresIn: 300,
  };
}

function tokens(): AepTokens {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    modelAccessToken: 'model-access-token',
    tokenType: 'Bearer',
    expiresIn: 900,
    modelAccessExpiresIn: 300,
    passwordChangeRequired: false,
  };
}

function identity(): CurrentIdentity {
  return {
    user: { id: 'user-1', displayName: 'Agent User' },
    enterprise: { id: 'demo', name: 'Zhiyuan Demo' },
    roles: ['member'],
    sessionExpiresAt: '2026-09-03T12:00:00Z',
    passwordChangeRequired: false,
  };
}
