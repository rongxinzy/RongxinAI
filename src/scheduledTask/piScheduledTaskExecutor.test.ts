import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

import type { PiContinueOptions, PiStartOptions } from '../main/libs/agentEngine/piRuntimeTypes';
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
                  content: 'previous answer',
                  timestamp: 1,
                  metadata: { isFinalAnswer: true },
                },
              ],
            }
          : null,
    },
  };
}

test('runs a canonical task in its workspace and returns its settled output', async () => {
  const startSession = vi.fn(async (_id: string, _prompt: string, options: PiStartOptions) => {
    options.onSettled?.({ ok: true, output: 'done' });
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    isSessionRunning: () => false,
    startSession,
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });
  const { session, store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({ sessionId: session.id, output: 'done' });
  expect(store.createSession).toHaveBeenCalledWith(
    '[定时]task',
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
  const startSession = vi.fn(async (_id: string, _prompt: string, options: PiStartOptions) => {
    options.onSettled?.({ ok: true, output: null });
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    isSessionRunning: () => false,
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
  ).resolves.toEqual({ sessionId: session.id, output: null });
  expect(store.createSession).not.toHaveBeenCalled();
  expect(startSession).toHaveBeenCalledWith(
    session.id,
    'run',
    expect.objectContaining({ workspaceRoot: session.cwd }),
  );
});

test('reuses one stable dedicated session for every run of a task-bound task', async () => {
  const startSession = vi.fn(async (_id: string, _prompt: string, options: PiStartOptions) => {
    runtimeActive = true;
    options.onSettled?.({ ok: true, output: 'done' });
  });
  let runtimeActive = false;
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => runtimeActive,
    isSessionRunning: () => false,
    startSession,
    continueSession: vi.fn(async (_id: string, _prompt: string, options: PiContinueOptions) => {
      options.onSettled?.({ ok: true, output: 'done' });
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
    '[定时]task',
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
  const startSession = vi.fn(async (_id: string, _prompt: string, options: PiStartOptions) => {
    runtimeActive = true;
    await new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    options.onSettled?.({ ok: true, output: 'done' });
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => runtimeActive,
    isSessionRunning: () => false,
    startSession,
    continueSession: vi.fn(async (_id: string, _prompt: string, options: PiContinueOptions) => {
      options.onSettled?.({ ok: true, output: 'next result' });
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
    isSessionRunning: () => false,
    startSession: async (_id: string, _prompt: string, options: PiStartOptions) => {
      options.onSettled?.({ ok: false, error: 'Scheduled task was stopped' });
    },
    continueSession: async () => undefined,
    stopSession: vi.fn(),
  });
  const { store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).rejects.toThrow('Scheduled task was stopped');
  expect(runtime.listenerCount('complete')).toBe(0);
  expect(runtime.listenerCount('error')).toBe(0);
  expect(runtime.listenerCount('sessionStopped')).toBe(0);
});

test('two different tasks bound to the same session get separate settled outputs', async () => {
  const { session, store } = createCoworkStore();
  const inputs: PiContinueOptions[] = [];
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => true,
    isSessionRunning: () => false,
    continueSession: vi.fn(async (_id: string, _prompt: string, options: PiContinueOptions) => {
      inputs.push(options);
    }),
    stopSession: vi.fn(),
  });
  const executor = new PiScheduledTaskExecutor(runtime as never, store as never);
  const firstTask = { ...task, sessionTarget: SessionTarget.Main, sessionKey: session.id };
  const first = executor.execute(firstTask, run);
  const second = executor.execute(
    { ...firstTask, id: 'second-task', sessionKey: `zhiyuan:${session.id}` },
    { ...run, id: 'second-run', taskId: 'second-task' },
  );

  await vi.waitFor(() => expect(inputs).toHaveLength(1));
  const onUnrelatedError = vi.fn();
  runtime.on('error', onUnrelatedError);
  runtime.emit('error', session.id, { message: 'Independent foreground input rejected' });
  runtime.off('error', onUnrelatedError);
  runtime.emit('complete', session.id);
  expect(inputs).toHaveLength(1);
  inputs[0].onSettled?.({ ok: true, output: 'first task answer' });
  await expect(first).resolves.toEqual({ sessionId: session.id, output: 'first task answer' });

  await vi.waitFor(() => expect(inputs).toHaveLength(2));
  inputs[1].onSettled?.({ ok: true, output: null });
  await expect(second).resolves.toEqual({ sessionId: session.id, output: null });
  expect(runtime.listenerCount('error')).toBe(0);
  expect(runtime.listenerCount('sessionStopped')).toBe(0);
});

test('does not attach to or stop a session that is already running', async () => {
  const { session, store } = createCoworkStore();
  const runtime = Object.assign(new EventEmitter(), {
    isSessionRunning: () => true,
    startSession: vi.fn(),
    continueSession: vi.fn(),
    stopSession: vi.fn(),
  });
  const mainSessionTask = { ...task, sessionTarget: SessionTarget.Main, sessionKey: session.id };
  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(mainSessionTask, run),
  ).rejects.toThrow('its session is running');
  expect(runtime.startSession).not.toHaveBeenCalled();
  expect(runtime.continueSession).not.toHaveBeenCalled();
  expect(runtime.stopSession).not.toHaveBeenCalled();
  expect(runtime.listenerCount('error')).toBe(0);
});

test('removes completion listeners when starting Pi fails', async () => {
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    isSessionRunning: () => false,
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
