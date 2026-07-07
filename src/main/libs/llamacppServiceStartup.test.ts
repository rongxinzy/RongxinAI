import { describe, expect, test, vi } from 'vitest';

import type { LlamaCppStatusSnapshot } from '../../shared/llamacpp';
import {
  classifyLlamaCppServiceStartupFailure,
  ensureLlamaCppServiceRunning,
  LlamaCppServiceStartupFailureCode,
  LlamaCppServiceStartupReason,
} from './llamacppServiceStartup';

describe('ensureLlamaCppServiceRunning', () => {
  test('returns immediately when the service is already running', async () => {
    const logger = testLogger();
    const runningStatus = status('running', undefined, { managedByApp: true, pid: 1234 });
    const manager = {
      detect: vi.fn(async () => runningStatus),
      start: vi.fn(async () => status('running')),
    };

    await expect(ensureLlamaCppServiceRunning(manager, loadModelOptions(logger))).resolves.toEqual({
      success: true,
      serviceStatus: runningStatus,
      retriedDetection: false,
    });
    expect(manager.detect).toHaveBeenCalledTimes(1);
    expect(manager.start).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[LlamaCpp] ensuring service before loading model');
    expect(logger.log).toHaveBeenCalledWith(
      '[LlamaCpp] service is already running before loading model, managed by this app with pid 1234',
    );
  });

  test('starts the service when it is installed but not running', async () => {
    const logger = testLogger();
    const startedStatus = status('running');
    const manager = {
      detect: vi.fn(async () => status('installed')),
      start: vi.fn(async () => startedStatus),
    };

    await expect(ensureLlamaCppServiceRunning(manager, loadModelOptions(logger))).resolves.toEqual({
      success: true,
      serviceStatus: startedStatus,
      retriedDetection: false,
    });
    expect(manager.detect).toHaveBeenCalledTimes(1);
    expect(manager.start).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('[LlamaCpp] starting service before loading model');
    expect(logger.log).toHaveBeenCalledWith(
      '[LlamaCpp] service is ready before loading model after startup',
    );
  });

  test('retries detection once after a failed start', async () => {
    const logger = testLogger();
    const detectedStatus = status('running');
    const manager = {
      detect: vi
        .fn<() => Promise<LlamaCppStatusSnapshot>>()
        .mockResolvedValueOnce(status('installed'))
        .mockResolvedValueOnce(detectedStatus),
      start: vi.fn(async () => status('error', 'llama.cpp did not become ready before timeout')),
    };

    await expect(ensureLlamaCppServiceRunning(manager, loadModelOptions(logger))).resolves.toEqual({
      success: true,
      serviceStatus: detectedStatus,
      retriedDetection: true,
    });
    expect(manager.detect).toHaveBeenCalledTimes(2);
    expect(manager.start).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      '[LlamaCpp] service was not ready before loading model; retrying detection once',
    );
    expect(logger.log).toHaveBeenCalledWith(
      '[LlamaCpp] service is ready before loading model after retry detection',
    );
  });

  test('classifies a port conflict after retry detection fails', async () => {
    const logger = testLogger();
    const startStatus = status('error', 'listen EADDRINUSE: address already in use 127.0.0.1:8080');
    const detectedStatus = status('installed');
    const manager = {
      detect: vi
        .fn<() => Promise<LlamaCppStatusSnapshot>>()
        .mockResolvedValueOnce(status('installed'))
        .mockResolvedValueOnce(detectedStatus),
      start: vi.fn(async () => startStatus),
    };

    await expect(ensureLlamaCppServiceRunning(manager, loadModelOptions(logger))).resolves.toMatchObject({
      success: false,
      code: LlamaCppServiceStartupFailureCode.PortInUse,
      serviceStatus: detectedStatus,
      startStatus,
      detectedStatus,
      retriedDetection: true,
    });
    expect(manager.detect).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[LlamaCpp] service startup failed before loading model with classification port-in-use',
    );
  });

  test('uses the manager status when start throws', async () => {
    const logger = testLogger();
    const currentStatus = status('error', 'llama.cpp exited unexpectedly during startup');
    const detectedStatus = status('error', 'llama.cpp exited unexpectedly during startup');
    const manager = {
      detect: vi
        .fn<() => Promise<LlamaCppStatusSnapshot>>()
        .mockResolvedValueOnce(status('installed'))
        .mockResolvedValueOnce(detectedStatus),
      start: vi.fn(async () => {
        throw new Error('process exited');
      }),
      getStatus: vi.fn(() => currentStatus),
    };

    await expect(ensureLlamaCppServiceRunning(manager, loadModelOptions(logger))).resolves.toMatchObject({
      success: false,
      code: LlamaCppServiceStartupFailureCode.ProcessExited,
      startStatus: expect.objectContaining({
        status: 'error',
        error: 'process exited',
      }),
      retriedDetection: true,
    });
  });
});

describe('classifyLlamaCppServiceStartupFailure', () => {
  test('prioritizes backend failures before generic process exits', () => {
    expect(classifyLlamaCppServiceStartupFailure({
      startStatus: status(
        'error',
        'llama.cpp exited unexpectedly during startup: CUDA error: no CUDA-capable device',
      ),
      detectedStatus: status('installed'),
    })).toMatchObject({
      code: LlamaCppServiceStartupFailureCode.BackendUnavailable,
    });
  });

  test('classifies startup timeouts', () => {
    expect(classifyLlamaCppServiceStartupFailure({
      startStatus: status('error', 'llama.cpp did not become ready before timeout'),
    })).toMatchObject({
      code: LlamaCppServiceStartupFailureCode.StartupTimeout,
    });
  });

  test('classifies damaged or missing runtime as runtime damage', () => {
    expect(classifyLlamaCppServiceStartupFailure({
      initialStatus: status('not-installed'),
      startStatus: status('not-installed', 'llama-server executable missing'),
    })).toMatchObject({
      code: LlamaCppServiceStartupFailureCode.RuntimeDamaged,
    });
  });

  test('classifies stopped service as process exited', () => {
    expect(classifyLlamaCppServiceStartupFailure({
      startStatus: status('stopped'),
      detectedStatus: status('installed'),
    })).toMatchObject({
      code: LlamaCppServiceStartupFailureCode.ProcessExited,
    });
  });

  test('falls back to unknown when no known pattern matches', () => {
    expect(classifyLlamaCppServiceStartupFailure({
      startStatus: status('error', 'unexpected service failure'),
      detectedStatus: status('installed'),
    })).toMatchObject({
      code: LlamaCppServiceStartupFailureCode.Unknown,
    });
  });
});

function status(
  value: LlamaCppStatusSnapshot['status'],
  error?: string,
  patch: Partial<LlamaCppStatusSnapshot> = {},
): LlamaCppStatusSnapshot {
  return {
    status: value,
    error,
    checkedAt: '2026-07-07T00:00:00.000Z',
    ...patch,
  };
}

function testLogger(): Pick<typeof console, 'log' | 'warn'> {
  return {
    log: vi.fn(),
    warn: vi.fn(),
  };
}

function loadModelOptions(logger: Pick<typeof console, 'log' | 'warn'>) {
  return {
    reason: LlamaCppServiceStartupReason.LoadModel,
    logger,
  };
}
