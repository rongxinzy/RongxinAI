import { randomUUID } from 'node:crypto';
import {
  DeliveryMode,
  PayloadKind,
  SessionTarget,
  WakeMode,
} from '../../scheduledTask/constants.js';
import type { ScheduledTask, ScheduledTaskInput } from '../../scheduledTask/types.js';
import { nextAutomationTime, normalizeAutomationSchedule } from './automationSchedule.mjs';

export function createAutomation(input: ScheduledTaskInput, now: number): ScheduledTask {
  const id = randomUUID();
  const createdAt = new Date(now).toISOString();
  const job: ScheduledTask = {
    ...input,
    id,
    description: input.description ?? '',
    delivery: input.delivery ?? { mode: DeliveryMode.None },
    workspaceId: input.workspaceId ?? null,
    sessionKey: input.sessionKey ?? null,
    createdAt,
    updatedAt: createdAt,
    state: {
      nextRunAtMs: null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
  };
  return normalizeAutomation(job, now, true);
}

export function normalizeAutomation(
  job: ScheduledTask,
  now: number,
  creating = false,
): ScheduledTask {
  if (job.sessionTarget !== SessionTarget.Isolated && job.sessionTarget !== SessionTarget.Task)
    throw new Error('Automation context must be isolated or task-scoped.');
  if (job.sessionKey != null) throw new Error('Automations use their own local task conversation.');
  if (job.wakeMode !== WakeMode.Now) throw new Error('Unsupported automation wake mode.');
  if (!job.name.trim()) throw new Error('Automation name is required.');
  const payload = job.payload;
  const prompt = payload.kind === PayloadKind.AgentTurn ? payload.message : payload.text;
  if (typeof prompt !== 'string' || !prompt.trim())
    throw new Error('Automation instructions are required.');
  if (
    payload.kind === PayloadKind.AgentTurn &&
    payload.timeoutSeconds !== undefined &&
    (!Number.isFinite(payload.timeoutSeconds) ||
      payload.timeoutSeconds < 1 ||
      payload.timeoutSeconds > 86_400)
  )
    throw new Error('Automation timeout must be between 1 and 86400 seconds.');
  if (
    job.delivery &&
    (job.delivery.mode !== DeliveryMode.None ||
      Object.keys(job.delivery).some(key => key !== 'mode'))
  )
    throw new Error('Automation results are local. Channel delivery is not supported.');
  const schedule = normalizeAutomationSchedule(job.schedule, now);
  const next = job.enabled ? nextAutomationTime(schedule, now, job.id) : null;
  if (creating && job.enabled && schedule.kind === 'at' && next === null)
    throw new Error('The one-time schedule must be a future ISO timestamp.');
  return {
    ...job,
    name: job.name.trim(),
    description: job.description.trim(),
    schedule,
    sessionTarget: job.sessionTarget,
    sessionKey: null,
    delivery: { mode: DeliveryMode.None },
    updatedAt: new Date(now).toISOString(),
    state: { ...job.state, nextRunAtMs: next },
  };
}
