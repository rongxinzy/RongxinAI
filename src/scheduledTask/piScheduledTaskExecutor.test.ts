import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';

import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { PiScheduledTaskExecutor } from './piScheduledTaskExecutor';
import type { ScheduledTask, ScheduledTaskRun } from './types';

test('runs a canonical task using the embedded Pi runtime and waits for complete', async () => {
  const runtime = Object.assign(new EventEmitter(), {
    isSessionActive: () => false,
    startSession: async (id: string) => { queueMicrotask(() => runtime.emit('complete', id, null)); },
    continueSession: async () => undefined, stopSession: () => undefined,
  });
  const session = { id: 'cowork-1', systemPrompt: '', activeSkillIds: [], cwd: process.cwd(), mode: 'work' as const, agentId: 'main', modelOverride: '', experts: [] };
  const coworkStore = { getConfig: () => ({ workingDirectory: process.cwd(), systemPrompt: '', executionMode: 'local' }), createSession: () => session, getSession: (id: string) => id === session.id ? { ...session, messages: [{ id: 'answer', type: 'assistant', content: 'done', timestamp: 1, metadata: { isFinalAnswer: true } }] } : null };
  const task: ScheduledTask = { id: 'task', name: 'task', description: '', enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 }, sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat, payload: { kind: PayloadKind.AgentTurn, message: 'run' },
    delivery: { mode: DeliveryMode.None }, agentId: 'main', sessionKey: null, state: { nextRunAtMs: null, lastRunAtMs: null, lastStatus: null, lastError: null, lastDurationMs: null, runningAtMs: null, consecutiveErrors: 0 }, createdAt: '', updatedAt: '' };
  const run: ScheduledTaskRun = { id: 'run', taskId: task.id, sessionId: null, sessionKey: null, status: 'running', startedAt: '', finishedAt: null, durationMs: null, error: null };
  await expect(new PiScheduledTaskExecutor(runtime as never, coworkStore as never).execute(task, run)).resolves.toEqual({ sessionId: 'cowork-1', output: 'done' });
});
