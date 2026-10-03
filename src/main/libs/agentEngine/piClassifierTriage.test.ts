import { describe, expect, it, vi } from 'vitest';

import {
  classifyTierWithPi,
  resetPiClassifierCache,
  setTriageClassifierDeps,
  type PiClassifierRuntime,
} from './piClassifierTriage';

const mockClassify = vi.fn();
const mockRegisterProvider = vi.fn();
const mockGetModel = vi.fn(() => ({ id: 'triage-model' }));

const makeRuntime = (): PiClassifierRuntime =>
  ({
    registerProvider: mockRegisterProvider,
    setRuntimeApiKey: vi.fn(),
    getModel: mockGetModel,
    classify: mockClassify,
  }) as unknown as PiClassifierRuntime;

const deps = {
  ModelRuntime: {
    create: vi.fn(async () => makeRuntime()),
  },
  llamaCppClassifyApi: vi.fn(() => ({ classify: mockClassify })),
};

describe('classifyTierWithPi', () => {
  it('returns the tier when confident and stopped cleanly', async () => {
    setTriageClassifierDeps(deps);
    mockClassify.mockResolvedValueOnce({
      stopReason: 'stop',
      answers: { tier: { type: 'choice', choice: 'heavy', confidence: 0.82 } },
    });

    const result = await classifyTierWithPi(
      'refactor the parser',
      { baseUrl: 'http://172.18.5.123:8000', modelName: 'Qwen3.6-35B-A3B' },
      deps,
    );

    expect(result).toEqual({ tier: 'heavy', confidence: 0.82 });
    // The provider registers against the server root with a classifier model.
    const registered = mockRegisterProvider.mock.calls[0]?.[1] as {
      baseUrl: string;
      models: Array<Record<string, unknown>>;
    };
    expect(registered.baseUrl).toBe('http://172.18.5.123:8000');
    expect(registered.models[0]).toMatchObject({
      type: 'classifier',
      api: 'llama-cpp-classify',
      baseUrl: 'http://172.18.5.123:8000/v1',
    });
  });

  it('falls back to null below the confidence floor or on errors', async () => {
    setTriageClassifierDeps(deps);
    resetPiClassifierCache();

    mockClassify.mockResolvedValueOnce({
      stopReason: 'stop',
      answers: { tier: { type: 'choice', choice: 'light', confidence: 0.4 } },
    });
    expect(
      await classifyTierWithPi('hi', { baseUrl: 'http://x:8000', modelName: 'm' }, deps),
    ).toBeNull();

    mockClassify.mockResolvedValueOnce({
      stopReason: 'error',
      errorMessage: 'server unavailable',
    });
    expect(
      await classifyTierWithPi('hi', { baseUrl: 'http://x:8000', modelName: 'm' }, deps),
    ).toBeNull();

    mockClassify.mockRejectedValueOnce(new Error('boom'));
    expect(await classifyTierWithPi('hi', { baseUrl: 'http://x:8000', modelName: 'm' })).toBeNull();
  });

  it('returns null without deps or with incomplete options', async () => {
    setTriageClassifierDeps(null);
    expect(
      await classifyTierWithPi('hi', { baseUrl: 'http://x:8000', modelName: 'm' }, deps),
    ).toBeNull();

    setTriageClassifierDeps(deps);
    expect(await classifyTierWithPi('hi', { baseUrl: '', modelName: 'm' })).toBeNull();
    expect(await classifyTierWithPi('hi', { baseUrl: 'http://x:8000', modelName: '' })).toBeNull();
    setTriageClassifierDeps(null);
  });
});
