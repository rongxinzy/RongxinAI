import { expect, test, vi } from 'vitest';

import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

import { IpcChannel } from '../../../scheduledTask/constants';
import { registerScheduledTaskHandlers } from './handlers';

test('task-list handler delegates to the canonical scheduler service', async () => {
  const listJobs = vi.fn(async () => []);
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ listJobs }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
    getOpenClawChannelGateway: () => ({
      getGatewayClient: () => null,
      fetchSessionByKey: async () => null,
    }),
  });
  const listHandler = electronMocks.handlers.get(IpcChannel.List);

  await expect(listHandler?.()).resolves.toEqual({ success: true, tasks: [] });
  expect(listJobs).toHaveBeenCalledOnce();
});
