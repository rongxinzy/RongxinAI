import { describe, expect, test } from 'vitest';

import {
  classifyLlamaCppModelLoadError,
  getLlamaCppModelLoadFailureI18nKey,
  isRetryableLlamaCppModelLoadError,
  LlamaCppModelLoadError,
  LlamaCppModelLoadFailureReason,
} from './llamacppModelLoadErrors';

describe('llamacppModelLoadErrors', () => {
  test('keeps an explicit model load error reason', () => {
    const error = new LlamaCppModelLoadError({
      reason: LlamaCppModelLoadFailureReason.GpuNotFound,
      detail: 'runtime device probe returned no GPU devices',
    });

    expect(classifyLlamaCppModelLoadError(error)).toBe(LlamaCppModelLoadFailureReason.GpuNotFound);
  });

  test('classifies GPU out-of-memory errors as insufficient VRAM', () => {
    expect(
      classifyLlamaCppModelLoadError(
        new Error('CUDA error: out of memory while allocating device buffer'),
      ),
    ).toBe(LlamaCppModelLoadFailureReason.VramInsufficient);

    expect(classifyLlamaCppModelLoadError('failed to allocate 8192 MiB of VRAM')).toBe(
      LlamaCppModelLoadFailureReason.VramInsufficient,
    );
  });

  test('classifies host allocation failures as insufficient system memory', () => {
    expect(
      classifyLlamaCppModelLoadError(new Error('std::bad_alloc while creating model context')),
    ).toBe(LlamaCppModelLoadFailureReason.SystemMemoryInsufficient);

    expect(classifyLlamaCppModelLoadError('cannot allocate memory for mmap buffer')).toBe(
      LlamaCppModelLoadFailureReason.SystemMemoryInsufficient,
    );
  });

  test('classifies GPU absence and GPU probe errors separately', () => {
    expect(classifyLlamaCppModelLoadError('CUDA error: no cuda-capable device is detected')).toBe(
      LlamaCppModelLoadFailureReason.GpuNotFound,
    );

    expect(classifyLlamaCppModelLoadError('nvidia-smi timed out while querying devices')).toBe(
      LlamaCppModelLoadFailureReason.GpuProbeFailed,
    );
  });

  test('classifies context, model file, service, and timeout errors', () => {
    expect(
      classifyLlamaCppModelLoadError('requested ctx-size exceeds supported context window'),
    ).toBe(LlamaCppModelLoadFailureReason.ContextTooLarge);

    expect(classifyLlamaCppModelLoadError('invalid GGUF magic while reading model file')).toBe(
      LlamaCppModelLoadFailureReason.ModelFileInvalid,
    );

    expect(classifyLlamaCppModelLoadError('fetch failed: ECONNREFUSED 127.0.0.1:8080')).toBe(
      LlamaCppModelLoadFailureReason.ServiceUnavailable,
    );

    expect(
      classifyLlamaCppModelLoadError('llama.cpp model qwen did not become ready before timeout'),
    ).toBe(LlamaCppModelLoadFailureReason.StartupTimeout);
  });

  test('classifies model limit and model-not-found errors', () => {
    expect(classifyLlamaCppModelLoadError('loaded model limit reached')).toBe(
      LlamaCppModelLoadFailureReason.ModelsLimitReached,
    );

    expect(
      classifyLlamaCppModelLoadError('model file does not exist: C:/models/missing.gguf'),
    ).toBe(LlamaCppModelLoadFailureReason.ModelNotFound);
  });

  test('marks only resource and transient startup failures retryable', () => {
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.VramInsufficient)).toBe(
      true,
    );
    expect(
      isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.SystemMemoryInsufficient),
    ).toBe(true);
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.ContextTooLarge)).toBe(
      true,
    );
    expect(
      isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.ServiceUnavailable),
    ).toBe(true);
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.StartupTimeout)).toBe(
      true,
    );

    expect(
      isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.ModelsLimitReached),
    ).toBe(false);
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.GpuNotFound)).toBe(
      false,
    );
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.GpuProbeFailed)).toBe(
      false,
    );
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.ModelFileInvalid)).toBe(
      false,
    );
    expect(isRetryableLlamaCppModelLoadError(LlamaCppModelLoadFailureReason.ModelNotFound)).toBe(
      false,
    );
  });

  test('maps failure reasons to main-process i18n keys', () => {
    expect(getLlamaCppModelLoadFailureI18nKey(LlamaCppModelLoadFailureReason.GpuNotFound)).toBe(
      'llamacppLoadModelGpuNotFound',
    );
    expect(getLlamaCppModelLoadFailureI18nKey(LlamaCppModelLoadFailureReason.Unknown)).toBe(
      'llamacppLoadModelUnknown',
    );
  });
});
