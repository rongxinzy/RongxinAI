import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MagpieModelService, installMagpieModelService } from '../../magpie/modelService';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => {
  const session = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
  };
  return {
    createAgentSession: vi.fn(async () => ({ session })),
  };
});

vi.mock('./durableSession.mjs', () => ({ createDurableSession: mocks.createAgentSession }));
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: vi.fn(),
  completeSimple: vi.fn(),
}));
vi.mock('../coworkUtil', async importOriginal => ({
  ...(await importOriginal<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: vi.fn(),
}));

describe('unified model readiness and actual inference', () => {
  let adapter: PiRuntimeAdapter;
  let directory: string;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PiRuntimeAdapter();
    directory = mkdtempSync(path.join(tmpdir(), 'durable-model-readiness-'));
    adapter.setPiSessionStoreRoot(directory);
    adapter.on('error', () => {});
  });
  afterEach(() => {
    adapter.stopAllSessions();
    dispose?.();
    rmSync(directory, { recursive: true, force: true });
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
