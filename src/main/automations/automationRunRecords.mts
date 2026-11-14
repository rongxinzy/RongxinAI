import type { ConversationId, Tx } from '@earendil-works/pi-durable';
import { PayloadKind, TaskStatus } from '../../scheduledTask/constants.js';
import type { ScheduledTask, ScheduledTaskRunWithName } from '../../scheduledTask/types.js';
import {
  AutomationDoc,
  AutomationEntry,
  automationSessionId,
  jobJson,
  readJob,
  runJson,
} from './automationState.mjs';

export type AutomationRunInput = {
  definition: import('@earendil-works/pi-durable').JsonObject;
  runId: string;
  scheduledAt: number;
  stopEpoch: number;
};
export type AutomationRunResult = { ok: boolean; error: string | null };
export type AutomationRunPhase =
  | { phase: 'acquire' }
  | { phase: 'reset'; startedAt: number }
  | { phase: 'submit'; startedAt: number }
  | { phase: 'await'; startedAt: number; deadline: number };

export function inputJob(input: AutomationRunInput): ScheduledTask {
  return input.definition as unknown as ScheduledTask;
}

export function runRecord(
  input: AutomationRunInput,
  startedAt: number,
  now?: number,
  error: string | null = null,
): ScheduledTaskRunWithName {
  const job = inputJob(input);
  return {
    id: input.runId,
    taskId: job.id,
    taskName: job.name,
    taskPayload:
      job.payload.kind === PayloadKind.AgentTurn ? job.payload.message : job.payload.text,
    sessionId: automationSessionId(job.id),
    sessionKey: automationSessionId(job.id),
    status: now === undefined ? TaskStatus.Running : error ? TaskStatus.Error : TaskStatus.Success,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: now === undefined ? null : new Date(now).toISOString(),
    durationMs: now === undefined ? null : Math.max(0, now - startedAt),
    error,
  };
}

export async function finishAutomationRun(
  tx: Tx,
  conversationId: ConversationId,
  input: AutomationRunInput,
  taskId: number,
  startedAt: number,
  now: number,
  failure: string | null,
): Promise<AutomationRunResult> {
  const state = await tx.doc(AutomationDoc);
  const error = state.activeError ?? failure;
  if (state.active === taskId) {
    state.active = null;
    state.activeError = null;
    const current = readJob(state);
    if (current) {
      current.state.runningAtMs = null;
      current.state.lastRunAtMs = startedAt;
      current.state.lastStatus = error ? TaskStatus.Error : TaskStatus.Success;
      current.state.lastError = error;
      current.state.lastDurationMs = Math.max(0, now - startedAt);
      current.state.consecutiveErrors = error ? current.state.consecutiveErrors + 1 : 0;
      state.job = jobJson(current);
    }
    await tx.appendEntry(conversationId, {
      kind: AutomationEntry.Run,
      data: runJson(runRecord(input, startedAt, now, error)),
    });
  }
  return { ok: error === null, error };
}
