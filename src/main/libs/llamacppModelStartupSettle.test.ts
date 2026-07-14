import { describe, expect, test, vi } from 'vitest';

import type { LlamaCppModel, LlamaCppStatusSnapshot } from '../../shared/llamacpp';
import {
  LlamaCppModelStartupObservedState,
  LlamaCppModelStartupSettleStatus,
  settleLlamaCppModelStartup,
} from './llamacppModelStartupSettle';

describe('settleLlamaCppModelStartup', () => {
  test('returns loaded when the target model is loaded', async () => {
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => [model('qwen.gguf', 'loaded')],
      wait: async () => undefined,
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.Loaded);
    expect(result.runningModels).toHaveLength(1);
  });

  test('treats a sleeping target model as loaded', async () => {
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => [model('qwen.gguf', 'sleeping')],
      wait: async () => undefined,
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.Loaded);
  });

  test('continues polling while the target model is loading', async () => {
    let currentTimeMs = 0;
    let listCalls = 0;
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => {
        listCalls += 1;
        return [model('qwen.gguf', listCalls === 1 ? 'loading' : 'loaded')];
      },
      timeoutMs: 10_000,
      pollIntervalMs: 1000,
      now: () => currentTimeMs,
      wait: async delayMs => {
        currentTimeMs += delayMs;
      },
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.Loaded);
    expect(listCalls).toBe(2);
  });

  test('returns failed when the target model reports an error state', async () => {
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => [model('qwen.gguf', 'error')],
      wait: async () => undefined,
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.Failed);
    if (result.status !== LlamaCppModelStartupSettleStatus.Loaded) {
      expect(result.observedState).toBe(LlamaCppModelStartupObservedState.Error);
    }
  });

  test('returns service unavailable when the service is not running', async () => {
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('stopped', 'process exited'),
      listModels: async () => [model('qwen.gguf', 'loaded')],
      wait: async () => undefined,
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.ServiceUnavailable);
    expect(result.runningModels).toEqual([]);
  });

  test('returns service unavailable when model polling throws', async () => {
    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => {
        throw new Error('fetch failed');
      },
      wait: async () => undefined,
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.ServiceUnavailable);
    if (result.status !== LlamaCppModelStartupSettleStatus.Loaded) {
      expect(result.detail).toBe('fetch failed');
    }
  });

  test('unloads a still-loading target model after startup timeout', async () => {
    let currentTimeMs = 0;
    const unloadModel = vi.fn(async () => undefined);

    const result = await settleLlamaCppModelStartup({
      modelName: 'qwen.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => [model('qwen.gguf', 'loading')],
      unloadModel,
      timeoutMs: 3000,
      pollIntervalMs: 1000,
      now: () => currentTimeMs,
      wait: async delayMs => {
        currentTimeMs += delayMs;
      },
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.StartupTimeout);
    if (result.status !== LlamaCppModelStartupSettleStatus.Loaded) {
      expect(result.observedState).toBe(LlamaCppModelStartupObservedState.Loading);
      expect(result.unloadedAfterTimeout).toBe(true);
    }
    expect(unloadModel).toHaveBeenCalledWith('qwen.gguf');
  });

  test('returns not found when the target model never appears before deadline', async () => {
    let currentTimeMs = 0;
    const result = await settleLlamaCppModelStartup({
      modelName: 'missing.gguf',
      detectService: async () => serviceStatus('running'),
      listModels: async () => [model('other.gguf', 'loaded')],
      timeoutMs: 2000,
      pollIntervalMs: 1000,
      now: () => currentTimeMs,
      wait: async delayMs => {
        currentTimeMs += delayMs;
      },
    });

    expect(result.status).toBe(LlamaCppModelStartupSettleStatus.NotFound);
    if (result.status !== LlamaCppModelStartupSettleStatus.Loaded) {
      expect(result.observedState).toBe(LlamaCppModelStartupObservedState.NotFound);
    }
  });
});

function serviceStatus(
  status: LlamaCppStatusSnapshot['status'],
  error?: string,
): LlamaCppStatusSnapshot {
  return {
    status,
    error,
    checkedAt: new Date(0).toISOString(),
  };
}

function model(name: string, status: NonNullable<LlamaCppModel['status']>): LlamaCppModel {
  return {
    name,
    id: name,
    model: name,
    status,
  };
}
