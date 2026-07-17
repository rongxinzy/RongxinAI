import { describe, expect, test, vi } from 'vitest';

import type { LlamaCppModelLaunchInput, LlamaCppRunningModel } from '../../shared/llamacpp';
import { LlamaCppModelLoadError, LlamaCppModelLoadFailureReason } from './llamacppModelLoadErrors';
import {
  halveLlamaCppModelLoadContext,
  LlamaCppModelLoadRetryDefaults,
  loadLlamaCppModelWithRetry,
} from './llamacppModelLoadRetry';

describe('llamacppModelLoadRetry', () => {
  test('runs at most two attempts when the default retry count is one', async () => {
    const attemptLoad = vi
      .fn()
      .mockRejectedValueOnce(new Error('CUDA error: out of memory'))
      .mockResolvedValueOnce({ ok: true });

    const result = await loadLlamaCppModelWithRetry({
      initialInput: inputWithContext(8192),
      attemptLoad,
    });

    expect(result.result).toEqual({ ok: true });
    expect(result.attempts).toHaveLength(2);
    expect(attemptLoad).toHaveBeenCalledTimes(2);
    expect(attemptLoad.mock.calls[0][0].options?.ctxSize).toBe(8192);
    expect(attemptLoad.mock.calls[1][0].options?.ctxSize).toBe(4096);
    expect(result.finalInput.options?.ctxSize).toBe(4096);
  });

  test('does not retry non-retryable failures', async () => {
    const attemptLoad = vi.fn(async () => {
      throw new LlamaCppModelLoadError({
        reason: LlamaCppModelLoadFailureReason.ModelFileInvalid,
        detail: 'invalid GGUF magic',
      });
    });

    await expect(
      loadLlamaCppModelWithRetry({
        initialInput: inputWithContext(8192),
        attemptLoad,
      }),
    ).rejects.toMatchObject({
      reason: LlamaCppModelLoadFailureReason.ModelFileInvalid,
    });

    expect(attemptLoad).toHaveBeenCalledTimes(1);
  });

  test('keeps context size at the minimum when halving', () => {
    expect(
      halveLlamaCppModelLoadContext(
        inputWithContext(256),
        LlamaCppModelLoadRetryDefaults.MinContextSize,
      ).options?.ctxSize,
    ).toBe(128);

    expect(
      halveLlamaCppModelLoadContext(
        inputWithContext(128),
        LlamaCppModelLoadRetryDefaults.MinContextSize,
      ).options?.ctxSize,
    ).toBe(128);
  });

  test('retries without changing input when ctxSize is absent', async () => {
    const attemptLoad = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'))
      .mockResolvedValueOnce('loaded');

    const result = await loadLlamaCppModelWithRetry({
      initialInput: { model: 'qwen.gguf' },
      attemptLoad,
    });

    expect(result.result).toBe('loaded');
    expect(attemptLoad).toHaveBeenCalledTimes(2);
    expect(attemptLoad.mock.calls[1][0].options?.ctxSize).toBeUndefined();
  });

  test('unloads the target running model before retry', async () => {
    const attemptLoad = vi
      .fn()
      .mockRejectedValueOnce(new Error('context too large'))
      .mockResolvedValueOnce('loaded');
    const unloadModel = vi.fn(async () => undefined);

    await loadLlamaCppModelWithRetry({
      initialInput: inputWithContext(4096),
      attemptLoad,
      listRunningModels: async () => [runningModel('C:/models/qwen.gguf', 'loading')],
      unloadModel,
    });

    expect(unloadModel).toHaveBeenCalledWith('C:/models/qwen.gguf');
  });

  test('skips unload when the target model is not present before retry', async () => {
    const attemptLoad = vi
      .fn()
      .mockRejectedValueOnce(new Error('context too large'))
      .mockResolvedValueOnce('loaded');
    const unloadModel = vi.fn(async () => undefined);

    await loadLlamaCppModelWithRetry({
      initialInput: inputWithContext(4096),
      attemptLoad,
      listRunningModels: async () => [runningModel('other.gguf', 'loaded')],
      unloadModel,
    });

    expect(unloadModel).not.toHaveBeenCalled();
  });
});

function inputWithContext(ctxSize: number): LlamaCppModelLaunchInput {
  return {
    model: 'qwen.gguf',
    options: {
      ctxSize,
    },
  };
}

function runningModel(
  name: string,
  status: NonNullable<LlamaCppRunningModel['status']>,
): LlamaCppRunningModel {
  return {
    name,
    id: name,
    model: name,
    status,
  };
}
