import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MagpieModelService, installMagpieModelService } from '../../magpie/modelService';
import { PiRuntimeAdapter } from './piRuntimeAdapter';

const mocks = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
  };
  return {
    createAgentSession: vi.fn(async () => ({ session })),
    resolveRawApiConfig: vi.fn(() => ({
      config: {
        apiKey: 'legacy-test-key',
        baseURL: 'http://127.0.0.1:1235/v1',
        model: 'legacy-model',
        apiType: 'openai',
      },
      providerMetadata: { providerName: 'legacy', modelName: 'Legacy model' },
    })),
    resolveRawApiConfigForModelRef: vi.fn(),
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mocks.createAgentSession,
  DefaultResourceLoader: class {
    async reload() {}
  },
  SessionManager: { inMemory: vi.fn(() => ({})) },
  SettingsManager: { create: vi.fn(() => ({ applyOverrides: vi.fn() })) },
  getAgentDir: vi.fn(() => '/tmp/pi-agent'),
  ModelRuntime: {
    create: vi.fn(async () => ({
      registerProvider: vi.fn(),
      setRuntimeApiKey: vi.fn().mockResolvedValue(undefined),
    })),
  },
  createCodemodeExtension: vi.fn(),
  createMcpExtension: vi.fn(),
  createToolSearchExtension: vi.fn(),
}));
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: vi.fn(),
  completeSimple: vi.fn(),
}));
vi.mock('../claudeSettings', () => ({
  resolveRawApiConfig: mocks.resolveRawApiConfig,
  resolveRawApiConfigForModelRef: mocks.resolveRawApiConfigForModelRef,
}));
vi.mock('../coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: vi.fn(),
  resolveGitBashPathForPi: vi.fn(),
}));

describe('unified model readiness and actual inference', () => {
  let adapter: PiRuntimeAdapter;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PiRuntimeAdapter();
    adapter.on('error', () => {});
  });
  afterEach(() => {
    adapter.stopAllSessions();
    dispose?.();
  });

  it.each(['disabled', 'revoked', 'unselected', 'catalog-failed'] as const)(
    'rejects %s unified models even when a legacy provider is configured',
    async scenario => {
      const service = new MagpieModelService(
        {
          status: () => ({
            state: scenario === 'disabled' ? 'stopped' : 'running',
            version: 'test',
            gatewayUrl: 'http://127.0.0.1:1234',
          }),
          models: async () => {
            if (scenario === 'catalog-failed') throw new Error('Catalog unavailable');
            return scenario === 'revoked' ? [] : [{ id: 'fixture/model' }];
          },
        },
        {
          readDefaultModelId: () => (scenario === 'unselected' ? null : 'fixture/model'),
          writeDefaultModelId: () => {},
        },
      );
      dispose = installMagpieModelService(service);
      const readiness = await service.checkReadiness();
      expect(readiness.hasConfig).toBe(false);
      await expect(adapter.startSession('unified-rejected', 'Hello')).rejects.toThrow(
        readiness.error,
      );
      expect(mocks.resolveRawApiConfig).not.toHaveBeenCalled();
      expect(mocks.resolveRawApiConfigForModelRef).not.toHaveBeenCalled();
      expect(mocks.createAgentSession).not.toHaveBeenCalled();
    },
  );

  it('uses the same selected unified model for readiness and actual inference', async () => {
    const service = new MagpieModelService(
      {
        status: () => ({
          state: 'running',
          version: 'test',
          gatewayUrl: 'http://127.0.0.1:1234',
        }),
        models: async () => [{ id: 'fixture/model' }],
      },
      { readDefaultModelId: () => 'fixture/model', writeDefaultModelId: () => {} },
    );
    dispose = installMagpieModelService(service);
    expect(await service.checkReadiness()).toEqual({ hasConfig: true, config: null });
    await adapter.startSession('unified-ready', 'Hello');
    expect(mocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ id: 'fixture/model', provider: 'magpie' }),
      }),
    );
  });
});
