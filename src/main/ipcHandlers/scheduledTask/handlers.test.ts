import { beforeEach, expect, test, vi } from 'vitest';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { IpcChannel } from '../../../scheduledTask/constants';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel, handler) => electronMocks.handlers.set(channel, handler)) },
}));
import { registerScheduledTaskHandlers } from './handlers';

const methods = () =>
  ({
    addJob: vi.fn(),
    updateJob: vi.fn(),
    removeJob: vi.fn(),
    listJobs: vi.fn(async () => []),
    getJob: vi.fn(),
    toggleJob: vi.fn(),
    runJob: vi.fn(),
    stopJob: vi.fn(async () => true),
    listRuns: vi.fn(),
    countRuns: vi.fn(),
    listAllRuns: vi.fn(),
    getJobNameSync: vi.fn(),
    hasRunningJobs: vi.fn(),
  }) satisfies ScheduledTaskService;
beforeEach(() => electronMocks.handlers.clear());
const input = {
  name: 'Task',
  description: '',
  enabled: false,
  schedule: { kind: 'every', everyMs: 1000 },
  sessionTarget: 'task',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Run.' },
};

test('local task handlers delegate list, stop, and session resolution', async () => {
  const service = methods();
  registerScheduledTaskHandlers({
    getScheduledTaskService: () => service,
    resolveSession: key => (key === 'automation:job' ? { id: key } : null),
  });
  await expect(electronMocks.handlers.get(IpcChannel.List)?.({})).resolves.toEqual({
    success: true,
    tasks: [],
  });
  await expect(electronMocks.handlers.get(IpcChannel.Stop)?.({}, 'job')).resolves.toEqual({
    success: true,
    result: true,
  });
  expect(service.stopJob).toHaveBeenCalledWith('job');
  await expect(
    electronMocks.handlers.get(IpcChannel.ResolveSession)?.({}, 'automation:job'),
  ).resolves.toEqual({ success: true, session: { id: 'automation:job' } });
  expect(
    [...electronMocks.handlers.keys()].some(key => /Channel|Deliver|preflight/.test(key)),
  ).toBe(false);
});

test('IPC rejects removed channel delivery and existing-chat binding before invoking service', async () => {
  const service = methods();
  registerScheduledTaskHandlers({ getScheduledTaskService: () => service });
  const create = electronMocks.handlers.get(IpcChannel.Create)!;
  await expect(
    create({}, { ...input, delivery: { mode: 'announce', channel: 'feishu', to: 'chat' } }),
  ).rejects.toThrow('invalid arguments');
  await expect(create({}, { ...input, sessionTarget: 'main' })).rejects.toThrow(
    'invalid arguments',
  );
  expect(service.addJob).not.toHaveBeenCalled();
});

test('native stop errors are returned as failures, without claiming success', async () => {
  const service = methods();
  service.stopJob.mockRejectedValueOnce(new Error('Storage unavailable.'));
  registerScheduledTaskHandlers({ getScheduledTaskService: () => service });
  await expect(electronMocks.handlers.get(IpcChannel.Stop)?.({}, 'job')).resolves.toEqual({
    success: false,
    error: 'Storage unavailable.',
  });
});
