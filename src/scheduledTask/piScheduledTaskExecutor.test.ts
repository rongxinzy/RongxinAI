import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

import { CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';

import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';
import { PiScheduledTaskExecutor } from './piScheduledTaskExecutor';
import type { ScheduledTask, ScheduledTaskRun } from './types';

const task: ScheduledTask = {
  id: 'task',
  name: 'task',
  description: '',
  enabled: true,
  schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.NextHeartbeat,
  payload: { kind: PayloadKind.AgentTurn, message: 'run' },
  delivery: { mode: DeliveryMode.None },
  workspaceId: 'finance-workspace',
  sessionKey: null,
  state: {
    nextRunAtMs: null,
    lastRunAtMs: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    runningAtMs: null,
    consecutiveErrors: 0,
  },
  createdAt: '',
  updatedAt: '',
};
const run: ScheduledTaskRun = {
  id: 'run',
  taskId: task.id,
  sessionId: null,
  sessionKey: null,
  status: TaskStatus.Running,
  startedAt: '',
  finishedAt: null,
  durationMs: null,
  error: null,
};

function createCoworkStore() {
  const session = {
    id: 'cowork-1',
    systemPrompt: 'Finance agent prompt',
    activeSkillIds: ['daily-trending'],
    cwd: 'D:/finance',
    mode: 'work' as const,
    agentId: 'main',
    workspaceId: task.workspaceId,
    modelOverride: 'provider/model',
    experts: [],
  };
  return {
    session,
    store: {
      getConfig: () => ({
        workingDirectory: process.cwd(),
        systemPrompt: 'Default prompt',
        executionMode: 'local',
      }),
      getWorkspace: () => ({ id: task.workspaceId, path: session.cwd }),
      createSession: vi.fn(() => session),
      getSession: (id: string) =>
        id === session.id
          ? {
              ...session,
              messages: [
                {
                  id: 'answer',
                  type: 'assistant',
                  content: 'done',
                  timestamp: 1,
                  metadata: { isFinalAnswer: true },
                },
              ],
            }
          : null,
    },
  };
}

test('runs a canonical task in its workspace and waits for complete', async () => {
  const startSession = vi.fn(async (id: string) => {
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession,
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });
  const { session, store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({ sessionId: session.id, output: 'done' });
  expect(store.createSession).toHaveBeenCalledWith(
    'Scheduled: task',
    session.cwd,
    'Default prompt',
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    task.workspaceId,
    [],
    CoworkSessionSource.Scheduled,
  );
  expect(startSession).toHaveBeenCalledWith(
    session.id,
    'run',
    expect.objectContaining({
      approvalMode: WorkbenchApprovalMode.AllowAll,
      unattended: true,
      skillIds: session.activeSkillIds,
      modelOverride: session.modelOverride,
    }),
  );
  expect(startSession.mock.calls[0]?.[2]).not.toHaveProperty('confirmationMode');
});

test('reuses the workspace session referenced by a managed session key', async () => {
  const startSession = vi.fn(async (id: string) => {
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession,
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });
  const { session, store } = createCoworkStore();
  const mainSessionTask = {
    ...task,
    sessionTarget: SessionTarget.Main,
    sessionKey: `zhiyuan:${session.id}`,
  };

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(mainSessionTask, run),
  ).resolves.toEqual({ sessionId: session.id, output: 'done' });
  expect(store.createSession).not.toHaveBeenCalled();
  expect(startSession).toHaveBeenCalledWith(
    session.id,
    'run',
    expect.objectContaining({ workspaceRoot: session.cwd }),
  );
});

test('reuses one stable dedicated session for every run of a task-bound task', async () => {
  const startSession = vi.fn(async (id: string) => {
    runtimeActive = true;
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  let runtimeActive = false;
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => runtimeActive,
    startSession,
    continueSession: vi.fn(async (id: string) => {
      queueMicrotask(() => runtime.emit('complete', id, null));
    }),
    stopSession: () => undefined,
  });
  const { session, store } = createCoworkStore();
  const taskBoundTask = { ...task, sessionTarget: SessionTarget.Task };
  let dedicatedExists = false;
  store.createSession.mockImplementation((...args) => {
    dedicatedExists = true;
    return { ...session, id: args[8] ?? `scheduled-task:${task.id}` };
  });
  store.getSession = (id: string) =>
    id === `scheduled-task:${task.id}` && dedicatedExists
      ? {
          ...session,
          id,
          messages: [{ id: 'answer', type: 'assistant', content: 'done', timestamp: 1 }],
        }
      : null;

  await new PiScheduledTaskExecutor(runtime as never, store as never).execute(taskBoundTask, run);
  expect(store.createSession).toHaveBeenCalledWith(
    'Scheduled: task',
    session.cwd,
    'Default prompt',
    'local',
    [],
    'main',
    '',
    'work',
    `scheduled-task:${task.id}`,
    task.workspaceId,
    [],
    CoworkSessionSource.Scheduled,
  );
  expect(startSession).toHaveBeenCalledWith(`scheduled-task:${task.id}`, 'run', expect.anything());

  await new PiScheduledTaskExecutor(runtime as never, store as never).execute(taskBoundTask, run);
  expect(store.createSession).toHaveBeenCalledTimes(1);
  expect(runtime.continueSession).toHaveBeenCalledWith(
    `scheduled-task:${task.id}`,
    'run',
    expect.objectContaining({
      approvalMode: WorkbenchApprovalMode.AllowAll,
      unattended: true,
    }),
  );
});

test('serializes overlapping runs for a task-bound session', async () => {
  let runtimeActive = false;
  let dedicatedExists = false;
  let releaseFirst: (() => void) | null = null;
  const startSession = vi.fn(async (id: string) => {
    runtimeActive = true;
    await new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => runtimeActive,
    startSession,
    continueSession: vi.fn(async (id: string) => {
      queueMicrotask(() => runtime.emit('complete', id, null));
    }),
    stopSession: () => undefined,
  });
  const { session, store } = createCoworkStore();
  const taskBoundTask = { ...task, sessionTarget: SessionTarget.Task };
  store.createSession.mockImplementation((...args) => {
    dedicatedExists = true;
    return { ...session, id: args[8] ?? `scheduled-task:${task.id}` };
  });
  store.getSession = (id: string) =>
    id === `scheduled-task:${task.id}` && dedicatedExists ? { ...session, id, messages: [] } : null;

  const executor = new PiScheduledTaskExecutor(runtime as never, store as never);
  const first = executor.execute(taskBoundTask, run);
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = executor.execute(taskBoundTask, { ...run, id: 'run-2' });
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(startSession).toHaveBeenCalledTimes(1);
  expect(runtime.continueSession).not.toHaveBeenCalled();

  releaseFirst?.();
  await first;
  await second;
  expect(runtime.continueSession).toHaveBeenCalledWith(
    `scheduled-task:${task.id}`,
    'run',
    expect.anything(),
  );
});

test('rejects immediately and removes listeners when Pi stops before completion', async () => {
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      queueMicrotask(() => runtime.emit('sessionStopped', id));
    },
    continueSession: async () => undefined,
    stopSession: vi.fn(),
  });
  const { session, store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).rejects.toThrow(`Scheduled task Pi session stopped before completion: ${session.id}`);
  expect(runtime.listenerCount('complete')).toBe(0);
  expect(runtime.listenerCount('error')).toBe(0);
  expect(runtime.listenerCount('sessionStopped')).toBe(0);
});

test('removes completion listeners when starting Pi fails', async () => {
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async () => {
      throw new Error('model unavailable');
    },
    continueSession: async () => undefined,
    stopSession: vi.fn(),
  });
  const { store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).rejects.toThrow('model unavailable');
  expect(runtime.listenerCount('complete')).toBe(0);
  expect(runtime.listenerCount('error')).toBe(0);
  expect(runtime.listenerCount('sessionStopped')).toBe(0);
});
