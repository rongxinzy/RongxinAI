import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

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
  agentId: 'finance-agent',
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
    agentId: task.agentId,
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
      getAgent: () => ({
        workingDirectory: session.cwd,
        systemPrompt: session.systemPrompt,
        skillIds: session.activeSkillIds,
        model: session.modelOverride,
      }),
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

test('runs a canonical task with its agent configuration and waits for complete', async () => {
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
    session.systemPrompt,
    'local',
    session.activeSkillIds,
    task.agentId,
    session.modelOverride,
    'work',
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
