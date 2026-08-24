import { expect, test, vi } from 'vitest';

import { LlamaCppBackendError } from '../../shared/llamacpp';
import {
  LlamaCppBackendSwitchServiceStatus,
  prepareLlamaCppBackendVersionSwitch,
  restartLlamaCppBackendVersionService,
} from './llamacppBackendVersionSwitch';

test('allows switching a stopped service without querying models', async () => {
  const listRunningModels = vi.fn(async () => []);
  const stop = vi.fn(async () => ({
    status: LlamaCppBackendSwitchServiceStatus.Stopped,
    checkedAt: '2026-08-24T00:00:00.000Z',
  }));

  await expect(
    prepareLlamaCppBackendVersionSwitch({
      serviceStatus: LlamaCppBackendSwitchServiceStatus.Stopped,
      listRunningModels,
      stop,
    }),
  ).resolves.toEqual({ success: true, restartService: false });
  expect(listRunningModels).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

test('blocks switching while the active service has a running model', async () => {
  const stop = vi.fn();

  await expect(
    prepareLlamaCppBackendVersionSwitch({
      serviceStatus: LlamaCppBackendSwitchServiceStatus.Running,
      listRunningModels: async () => [{ name: 'qwen-local' }],
      stop,
    }),
  ).resolves.toEqual({
    success: false,
    error: LlamaCppBackendError.SwitchRequiresStoppedService,
  });
  expect(stop).not.toHaveBeenCalled();
});

test('stops and restarts an active service with no running models before switching', async () => {
  const stop = vi.fn(async () => ({
    status: LlamaCppBackendSwitchServiceStatus.Stopped,
    checkedAt: '2026-08-24T00:00:00.000Z',
  }));

  await expect(
    prepareLlamaCppBackendVersionSwitch({
      serviceStatus: LlamaCppBackendSwitchServiceStatus.Running,
      listRunningModels: async () => [],
      stop,
    }),
  ).resolves.toEqual({ success: true, restartService: true });
  expect(stop).toHaveBeenCalledTimes(1);

  await expect(
    restartLlamaCppBackendVersionService({
      start: async () => ({
        status: LlamaCppBackendSwitchServiceStatus.Running,
        checkedAt: '2026-08-24T00:00:00.000Z',
      }),
    }),
  ).resolves.toEqual({ success: true });
});

test('blocks switching when the running model state cannot be inspected', async () => {
  await expect(
    prepareLlamaCppBackendVersionSwitch({
      serviceStatus: LlamaCppBackendSwitchServiceStatus.Running,
      listRunningModels: async () => {
        throw new Error('request failed');
      },
      stop: vi.fn(),
    }),
  ).resolves.toEqual({
    success: false,
    error: LlamaCppBackendError.SwitchRequiresStoppedService,
  });
});
