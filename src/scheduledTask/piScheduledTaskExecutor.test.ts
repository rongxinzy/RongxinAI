import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

import { CoworkSessionSource } from '../shared/cowork/constants';

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
      autoApprove: true,
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
