import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

import { CoworkSessionSource } from '../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../shared/workbenchTask';

import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  ScheduledTaskMessageSource,
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
  const messages: Array<Record<string, unknown>> = [];
  return {
    session,
    messages,
    store: {
      getConfig: () => ({
        workingDirectory: process.cwd(),
        systemPrompt: 'Default prompt',
        executionMode: 'local',
      }),
      getWorkspace: () => ({ id: task.workspaceId, path: session.cwd }),
      createSession: vi.fn(() => session),
      getSession: (id: string) =>
        id === session.id ? { ...session, messages } : null,
    },
  };
}

test('runs a canonical task in its workspace and waits for complete', async () => {
  const startSession = vi.fn(async (id: string) => {
    messages.push({
      id: 'answer',
      type: 'assistant',
      content: 'done',
      timestamp: 1,
      metadata: { isFinalAnswer: true },
    });
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession,
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });
  const { session, messages, store } = createCoworkStore();

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: 'done',
    answerTruncated: false,
    truncationNotice: null,
  });
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
  const { session, messages, store } = createCoworkStore();
  const mainSessionTask = {
    ...task,
    sessionTarget: SessionTarget.Main,
    sessionKey: `zhiyuan:${session.id}`,
  };
  const startSession = vi.fn(async (id: string) => {
    messages.push({ id: 'answer', type: 'assistant', content: 'done', timestamp: 1 });
    queueMicrotask(() => runtime.emit('complete', id, null));
  });
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession,
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(mainSessionTask, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: 'done',
    answerTruncated: false,
    truncationNotice: null,
  });
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

test('a run without new assistant output never re-delivers a prior delivery write-back', async () => {
  const { session, messages, store } = createCoworkStore();
  // Prior run history ends with the delivery transport's write-back.
  messages.push(
    { id: 'old-answer', type: 'assistant', content: 'previous run answer', timestamp: 1 },
    {
      id: 'write-back',
      type: 'assistant',
      content: 'previous run answer',
      timestamp: 2,
      metadata: { source: ScheduledTaskMessageSource.Delivery },
    },
  );
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      queueMicrotask(() => runtime.emit('complete', id, null));
    },
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: null,
    answerTruncated: false,
    truncationNotice: null,
  });
});

test('a delivery write-back persisted inside the run boundary is never the run output', async () => {
  const { session, messages, store } = createCoworkStore();
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      // The previous delivery lands while this run is executing (the per-task
      // lock is released before the scheduler dispatches), so the write-back
      // is INSIDE this run's boundary and arrives after the real answer.
      messages.push(
        { id: 'user-prompt', type: 'user', content: 'run', timestamp: 1 },
        { id: 'answer', type: 'assistant', content: 'this run answer', timestamp: 2 },
        {
          id: 'write-back',
          type: 'assistant',
          content: 'previous run answer (delivered again)',
          timestamp: 3,
          metadata: { source: ScheduledTaskMessageSource.Delivery, answerTruncated: false },
        },
      );
      queueMicrotask(() => runtime.emit('complete', id, null));
    },
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: 'this run answer',
    answerTruncated: false,
    truncationNotice: null,
  });
});

test('a length stop with no persisted answer text still reports the disclosure', async () => {
  const { session, messages, store } = createCoworkStore();
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      // Mirror the adapter contract for an empty-text length stop: no
      // assistant message is persisted (empty final content never becomes an
      // answer), but the runtime still persists the disclosure before
      // completing.
      messages.push(
        { id: 'user-prompt', type: 'user', content: 'run', timestamp: 1 },
        {
          id: 'disclosure',
          type: 'system',
          content: '回复因达到单次输出长度上限被截断，内容可能不完整。',
          timestamp: 2,
          metadata: { answerTruncated: true, stopReason: 'length' },
        },
      );
      queueMicrotask(() => runtime.emit('complete', id, null));
    },
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: null,
    answerTruncated: true,
    truncationNotice: '回复因达到单次输出长度上限被截断，内容可能不完整。',
  });
});

test('a truncated terminal answer reports the persisted disclosure', async () => {
  const { session, messages, store } = createCoworkStore();
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      // Mirror the adapter contract: length-stopped answer, then the explicit
      // disclosure, then complete.
      messages.push(
        {
          id: 'user-prompt',
          type: 'user',
          content: 'run',
          timestamp: 1,
        },
        {
          id: 'answer',
          type: 'assistant',
          content: 'partial answer',
          timestamp: 2,
          metadata: { stopReason: 'length', truncated: true },
        },
        {
          id: 'disclosure',
          type: 'system',
          content: '回复因达到单次输出长度上限被截断，内容可能不完整。',
          timestamp: 3,
          metadata: { answerTruncated: true, stopReason: 'length' },
        },
      );
      queueMicrotask(() => runtime.emit('complete', id, null));
    },
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  await expect(
    new PiScheduledTaskExecutor(runtime as never, store as never).execute(task, run),
  ).resolves.toEqual({
    sessionId: session.id,
    output: 'partial answer',
    answerTruncated: true,
    truncationNotice: '回复因达到单次输出长度上限被截断，内容可能不完整。',
  });
});

test('truncation older than the run boundary or superseded by a later clean turn stays clean', async () => {
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => {
      queueMicrotask(() => runtime.emit('complete', id, null));
    },
    continueSession: async () => undefined,
    stopSession: () => undefined,
  });

  // An earlier turn's truncation (plus its disclosure and write-back) sits
  // before the boundary; this run produces a clean answer.
  const before = createCoworkStore();
  before.messages.push(
    {
      id: 'old-answer',
      type: 'assistant',
      content: 'old truncated answer',
      timestamp: 1,
      metadata: { stopReason: 'length', truncated: true },
    },
    {
      id: 'old-disclosure',
      type: 'system',
      content: 'old notice',
      timestamp: 2,
      metadata: { answerTruncated: true },
    },
    {
      id: 'old-write-back',
      type: 'assistant',
      content: 'old truncated answer',
      timestamp: 3,
      metadata: { source: ScheduledTaskMessageSource.Delivery, answerTruncated: true },
    },
  );
  const { session: sessionA, messages: messagesA, store: storeA } = before;
  const runStartA = runtime.startSession;
  runtime.startSession = async (id: string) => {
    messagesA.push({ id: 'answer-a', type: 'assistant', content: 'clean answer', timestamp: 4 });
    return runStartA(id);
  };
  await expect(
    new PiScheduledTaskExecutor(runtime as never, storeA as never).execute(task, run),
  ).resolves.toMatchObject({
    sessionId: sessionA.id,
    output: 'clean answer',
    answerTruncated: false,
    truncationNotice: null,
  });

  // Within one boundary: a truncated turn disclosed, then a drained follow-up
  // turn that completes cleanly — the disclosure is stale, the run is clean.
  const after = createCoworkStore();
  const { session: sessionB, messages: messagesB, store: storeB } = after;
  const runStartB = runtime.startSession;
  runtime.startSession = async (id: string) => {
    messagesB.push(
      {
        id: 'answer-b1',
        type: 'assistant',
        content: 'first partial',
        timestamp: 1,
        metadata: { stopReason: 'length', truncated: true },
      },
      {
        id: 'disclosure-b',
        type: 'system',
        content: 'notice b',
        timestamp: 2,
        metadata: { answerTruncated: true },
      },
      { id: 'answer-b2', type: 'assistant', content: 'completed follow-up answer', timestamp: 3 },
    );
    return runStartB(id);
  };
  await expect(
    new PiScheduledTaskExecutor(runtime as never, storeB as never).execute(task, run),
  ).resolves.toMatchObject({
    sessionId: sessionB.id,
    output: 'completed follow-up answer',
    answerTruncated: false,
    truncationNotice: null,
  });
});
