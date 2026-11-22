import { expect, test, vi } from 'vitest';

import { LlamaCppBackendError } from '../../shared/llamacpp';
import type { LlamaCppModelDaemonStatus } from './llamacppModelDaemonProtocol';
import { switchLlamaCppBackend } from './llamacppBackendVersionSwitch';

const running = { status: 'running', checkedAt: '2026-08-24T00:00:00.000Z' } as const;
const idle: LlamaCppModelDaemonStatus = {
  status: running,
  runningModels: [],
  modelProcesses: [],
  gatewayBaseUrl: null,
};

function fixture(snapshot: LlamaCppModelDaemonStatus | null) {
  const steps: string[] = [];
  const runtime = {
    reconnect: vi.fn(async () => snapshot),
    stopService: vi.fn(async () => {
      steps.push('stop');
    }),
    start: vi.fn(async () => {
      steps.push('start');
      return running;
    }),
  };
  const input = {
    runtime,
    busy: vi.fn(() => false),
    activate: () => {
      steps.push('activate');
    },
    restore: () => {
      steps.push('restore');
    },
  };
  return { input, runtime, steps };
}

test('activates a backend for a stopped service without starting a process', async () => {
  const { input, runtime, steps } = fixture(null);
  await switchLlamaCppBackend(input);
  expect(runtime.reconnect).toHaveBeenCalledExactlyOnceWith({ requireResponsive: true });
  expect(steps).toEqual(['activate']);
});

test.each([
  { ...idle, runningModels: [{ name: 'qwen-local' }] },
  { ...idle, modelProcesses: [{ modelName: 'starting', modelPath: '/fixture.gguf', port: 10000 }] },
])('preserves the selected runtime while it owns model processes', async snapshot => {
  const { input, steps } = fixture(snapshot);
  await expect(switchLlamaCppBackend(input)).rejects.toThrow(
    LlamaCppBackendError.SwitchRequiresStoppedService,
  );
  expect(steps).toEqual([]);
});

test('stops an idle runtime before switching and restarts the same owner', async () => {
  const { input, runtime, steps } = fixture(idle);
  await switchLlamaCppBackend(input);
  expect(steps).toEqual(['stop', 'activate', 'start']);
  expect(runtime.stopService).toHaveBeenCalledExactlyOnceWith({ requireIdle: true });
});

test('restores the previous backend after the new runtime fails to start', async () => {
  const { input, runtime, steps } = fixture(idle);
  vi.spyOn(runtime, 'start').mockImplementationOnce(async () => {
    steps.push('failed start');
    throw new Error('startup failed');
  });
  await expect(switchLlamaCppBackend(input)).rejects.toThrow('startup failed');
  expect(steps).toEqual(['stop', 'activate', 'failed start', 'stop', 'restore', 'start']);
});

test('does not activate if the selected runtime cannot be inspected', async () => {
  const { input, runtime, steps } = fixture(null);
  runtime.reconnect.mockRejectedValue(new Error('request failed'));
  await expect(switchLlamaCppBackend(input)).rejects.toThrow(
    LlamaCppBackendError.SwitchRequiresStoppedService,
  );
  expect(steps).toEqual([]);
});

test('does not activate while a model request is being admitted', async () => {
  const { input, steps } = fixture(idle);
  input.busy.mockReturnValue(true);
  await expect(switchLlamaCppBackend(input)).rejects.toThrow(
    LlamaCppBackendError.SwitchRequiresStoppedService,
  );
  expect(steps).toEqual([]);
});
