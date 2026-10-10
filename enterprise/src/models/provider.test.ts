import type {
  AepSessionState,
  AepTokens,
  AgentModel,
  CurrentIdentity,
  ModelConnection,
  ServiceMetadata,
} from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';

import { ModelCapabilityStatus } from '../host-contract.js';
import { type PasswordSessionClient, ZhiyuanPasswordSession } from '../session/password-session.js';
import {
  ZHIYUAN_MODEL_PROVIDER_DISPLAY_NAME,
  ZHIYUAN_MODEL_PROVIDER_KEY,
  ZhiyuanModelProvider,
} from './provider.js';

describe('ZhiyuanModelProvider', () => {
  test('projects assigned gateway models into a managed custom provider snapshot', async () => {
    const client = mockClient({
      listAgentModels: vi.fn(async () => ({
        models: [
          model({ id: 'secondary', displayName: 'Secondary', isDefault: false }),
          model({
            capabilities: ['text', 'streaming', 'tools', 'vision', 'reasoning'],
            reasoningCompatibility: {
              thinkingFormat: 'zai',
              supportsReasoningEffort: true,
              requiresReasoningContentOnAssistantMessages: true,
              thinkingLevelMap: {
                off: null,
                minimal: null,
                low: 'low',
                medium: null,
                high: 'high',
                xhigh: null,
                max: 'max',
              },
            },
            contextWindow: 128_000,
          }),
          model({ id: 'disabled', enabled: false }),
          model({ id: 'local', sourceType: 'local' }),
        ],
      })),
    });
    const provider = new ZhiyuanModelProvider(await authenticatedSession(client));

    expect(provider.providerKey).toBe(ZHIYUAN_MODEL_PROVIDER_KEY);
    expect(provider.providerKey).toBe('custom_enterprise');
    expect(ZHIYUAN_MODEL_PROVIDER_DISPLAY_NAME).toBe('Zhiyuan');
    expect(provider.exclusive).toBe(true);
    await expect(provider.snapshot()).resolves.toEqual({
      enabled: true,
      userEnabled: true,
      apiKey: 'model-token',
      baseUrl: 'https://gateway.example/v1',
      apiFormat: 'openai',
      displayName: 'Zhiyuan',
      models: [
        {
          id: 'enterprise-chat',
          name: 'Enterprise Chat',
          supportsImage: true,
          capabilities: {
            toolCalling: ModelCapabilityStatus.Supported,
            imageInput: ModelCapabilityStatus.Supported,
            reasoning: ModelCapabilityStatus.Supported,
          },
          contextWindow: 128_000,
          piRuntime: {
            api: 'openai-completions',
            reasoning: true,
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: 'low',
              medium: null,
              high: 'high',
              xhigh: null,
              max: 'max',
            },
            compat: {
              thinkingFormat: 'zai',
              supportsReasoningEffort: true,
              requiresReasoningContentOnAssistantMessages: true,
            },
          },
        },
        { id: 'secondary', name: 'Secondary' },
      ],
    });
    expect(client.getModelConnection).toHaveBeenCalledOnce();
  });

  test('signals login changes and remote assignment changes without overlapping polls', async () => {
    let models = [model()];
    let poll: (() => void) | null = null;
    const clearInterval = vi.fn();
    const refreshEntitlement = vi.fn(async () => undefined);
    const client = mockClient({ listAgentModels: vi.fn(async () => ({ models })) });
    const session = new ZhiyuanPasswordSession(client);
    const provider = new ZhiyuanModelProvider(session, {
      pollIntervalMs: 10,
      setInterval: callback => {
        poll = callback;
        return { unref: vi.fn() };
      },
      clearInterval,
      refreshEntitlement,
    });
    const changed = vi.fn();
    const unsubscribe = provider.onDidChange(changed);

    await session.login({
      aepBaseUrl: 'https://aep.example.test',
      username: 'admin',
      password: 'secret',
    });
    expect(changed).toHaveBeenCalledOnce();
    await provider.snapshot();
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);

    models = [model(), model({ id: 'second', displayName: 'Second Model', isDefault: false })];
    poll!();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(refreshEntitlement).toHaveBeenCalledTimes(2);

    unsubscribe();
    unsubscribe();
    expect(clearInterval).toHaveBeenCalledOnce();
  });

  test('uses the activated entitlement token for enterprise inference', async () => {
    const provider = new ZhiyuanModelProvider(await authenticatedSession(mockClient()), {
      getEntitlementToken: () => 'entitlement-token',
      requireEntitlement: true,
    });

    await expect(provider.snapshot()).resolves.toMatchObject({ apiKey: 'entitlement-token' });
  });

  test('does not expose models before a required entitlement is active', async () => {
    const provider = new ZhiyuanModelProvider(await authenticatedSession(mockClient()), {
      getEntitlementToken: () => null,
      requireEntitlement: true,
    });

    await expect(provider.snapshot()).rejects.toThrow('requires an active License entitlement');
  });

  test('rejects a gateway with an incompatible protocol', async () => {
    const provider = new ZhiyuanModelProvider(
      await authenticatedSession(
        mockClient({
          getModelConnection: vi.fn(async () => ({
            ...connection(),
            protocol: 'anthropic-compatible' as never,
          })),
        }),
      ),
    );

    await expect(provider.snapshot()).rejects.toThrow('protocol is not supported');
  });

  test('rejects unsupported reasoning compatibility metadata', async () => {
    const provider = new ZhiyuanModelProvider(
      await authenticatedSession(
        mockClient({
          listAgentModels: vi.fn(async () => ({
            models: [
              model({
                reasoningCompatibility: {
                  thinkingFormat: 'deepseek',
                  // Deliberately violate the protocol type to exercise the
                  // provider's runtime rejection path.
                  supportsReasoningEffort: false as unknown as true,
                  requiresReasoningContentOnAssistantMessages: true,
                },
              }),
            ],
          })),
        }),
      ),
    );

    await expect(provider.snapshot()).rejects.toThrow('reasoning compatibility is not supported');
  });

  test('fails the snapshot during a control-plane outage', async () => {
    const provider = new ZhiyuanModelProvider(
      await authenticatedSession(
        mockClient({ listAgentModels: vi.fn(async () => Promise.reject(new Error('outage'))) }),
      ),
    );

    await expect(provider.snapshot()).rejects.toThrow('outage');
    expect(provider.exclusive).toBe(true);
  });

  test('projects anthropic gateway models with per-model base URLs on a v2 host', async () => {
    const client = mockClient({
      listAgentModels: vi.fn(async () => ({
        models: [
          model({ id: 'bench-anthropic', displayName: 'Bench Anthropic', protocol: 'anthropic' }),
        ],
      })),
    });
    const provider = new ZhiyuanModelProvider(await authenticatedSession(client), {
      hostManagedProviderApiVersion: 2,
    });

    const snapshot = await provider.snapshot();

    expect(snapshot.apiFormat).toBe('openai');
    expect(snapshot.models).toEqual([
      {
        id: 'bench-anthropic',
        name: 'Bench Anthropic',
        baseUrl: 'https://gateway.example/bench-anthropic',
        piRuntime: { api: 'anthropic-messages' },
      },
    ]);
  });

  test('keeps default-first ordering across protocols in a mixed catalog', async () => {
    const client = mockClient({
      listAgentModels: vi.fn(async () => ({
        models: [
          model({ id: 'openai-secondary', isDefault: false }),
          model({ id: 'bench-anthropic', protocol: 'anthropic', isDefault: false }),
          model({ id: 'openai-default', displayName: 'OpenAI Default', isDefault: true }),
        ],
      })),
    });
    const provider = new ZhiyuanModelProvider(await authenticatedSession(client), {
      hostManagedProviderApiVersion: 2,
    });

    const snapshot = await provider.snapshot();

    expect(snapshot.models?.map(entry => entry.id)).toEqual([
      'openai-default',
      'openai-secondary',
      'bench-anthropic',
    ]);
  });

  test('withholds anthropic models from hosts below managed provider capability v2', async () => {
    const client = mockClient({
      listAgentModels: vi.fn(async () => ({
        models: [
          model({ id: 'openai-default' }),
          model({ id: 'bench-anthropic', protocol: 'anthropic' }),
        ],
      })),
    });
    const explicitV1 = new ZhiyuanModelProvider(await authenticatedSession(client), {
      hostManagedProviderApiVersion: 1,
    });
    const defaulted = new ZhiyuanModelProvider(await authenticatedSession(client));

    for (const provider of [explicitV1, defaulted]) {
      const snapshot = await provider.snapshot();
      expect(snapshot.models?.map(entry => entry.id)).toEqual(['openai-default']);
    }
  });

  test('derives anthropic per-model base URLs from the gateway origin', async () => {
    const listAgentModels = vi.fn(async () => ({
      models: [model({ id: 'bench-anthropic', protocol: 'anthropic' })],
    }));
    const withTrailingSlash = new ZhiyuanModelProvider(
      await authenticatedSession(
        mockClient({
          listAgentModels,
          getModelConnection: vi.fn(async () => ({
            ...connection(),
            baseUrl: 'https://gateway.example/v1/',
          })),
        }),
      ),
      { hostManagedProviderApiVersion: 2 },
    );
    const withoutV1Segment = new ZhiyuanModelProvider(
      await authenticatedSession(
        mockClient({
          listAgentModels,
          getModelConnection: vi.fn(async () => ({
            ...connection(),
            baseUrl: 'https://gateway.example',
          })),
        }),
      ),
      { hostManagedProviderApiVersion: 2 },
    );

    expect((await withTrailingSlash.snapshot()).models?.[0]?.baseUrl).toBe(
      'https://gateway.example/bench-anthropic',
    );
    expect((await withoutV1Segment.snapshot()).models?.[0]?.baseUrl).toBe(
      'https://gateway.example/bench-anthropic',
    );
  });
});

async function authenticatedSession(
  client: PasswordSessionClient,
): Promise<ZhiyuanPasswordSession> {
  const session = new ZhiyuanPasswordSession(client);
  await session.login({
    aepBaseUrl: 'https://aep.example.test',
    username: 'admin',
    password: 'secret',
  });
  return session;
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
    listAgentModels: vi.fn(async () => ({ models: [] })),
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
    deploymentId: 'enterprise-1',
  };
}

type ReasoningAwareAgentModel = Omit<AgentModel, 'reasoningCompatibility'> & {
  reasoningCompatibility?: {
    thinkingFormat: 'deepseek' | 'zai';
    supportsReasoningEffort: boolean;
    requiresReasoningContentOnAssistantMessages: boolean;
    thinkingLevelMap?: Partial<
      Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>
    >;
  };
};

function model(overrides: Partial<ReasoningAwareAgentModel> = {}): AgentModel {
  return {
    id: 'enterprise-chat',
    displayName: 'Enterprise Chat',
    sourceType: 'gateway',
    protocol: 'openai-compatible',
    capabilities: ['text', 'streaming'],
    isDefault: true,
    enabled: true,
    ...overrides,
  } as unknown as AgentModel;
}

function connection(): ModelConnection {
  return {
    baseUrl: 'https://gateway.example/v1',
    protocol: 'openai-compatible',
    apiVersion: 'v1',
    apiKey: 'model-token',
    expiresIn: 300,
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
    sessionExpiresAt: '2026-08-25T11:00:00Z',
    passwordChangeRequired: false,
  };
}
