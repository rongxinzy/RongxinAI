import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from '../../../scheduledTask/constants';
import type { ScheduledTaskInput } from '../../../scheduledTask/types';

export function buildPiScheduledTaskTool(input: {
  service: ScheduledTaskService;
  workspaceId?: string | null;
  sessionKey?: string | null;
}): Record<string, unknown> {
  return {
    name: 'scheduled_task',
    label: 'Scheduled Task',
    description:
      'Create a scheduled task after confirming the task content, schedule, and notification method with the user.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short task name.' },
        description: { type: 'string', description: 'What the task does.' },
        schedule: {
          type: 'object',
          description: 'Schedule: {kind:"at",at} or {kind:"cron",expr,tz} or {kind:"every",everyMs}.',
        },
        message: { type: 'string', description: 'Prompt executed when the task runs.' },
        delivery: {
          type: 'object',
          description: 'Optional delivery: {mode:"none"|"announce"|"webhook",channel,to,accountId}.',
        },
      },
      required: ['name', 'schedule', 'message'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      const message = typeof params.message === 'string' ? params.message.trim() : '';
      const schedule = params.schedule;
      if (!name || !message || !schedule || typeof schedule !== 'object') {
        return { content: [{ type: 'text', text: 'Task name, schedule, and message are required.' }], details: { isError: true } };
      }
      const normalizedSchedule = validateSchedule(schedule);
      if (normalizedSchedule.ok === false) return failure(normalizedSchedule.error);
      const delivery = params.delivery && typeof params.delivery === 'object' ? params.delivery as Record<string, unknown> : undefined;
      const normalizedDelivery = validateDelivery(delivery);
      if (normalizedDelivery.ok === false) return failure(normalizedDelivery.error);
      const taskInput: ScheduledTaskInput = {
        name,
        description: typeof params.description === 'string' ? params.description.trim() : message,
        enabled: true,
        schedule: normalizedSchedule.value,
        sessionTarget: SessionTarget.Main,
        wakeMode: WakeMode.Now,
        payload: { kind: PayloadKind.AgentTurn, message },
        delivery: normalizedDelivery.value,
        workspaceId: input.workspaceId ?? null,
        sessionKey: input.sessionKey ?? null,
      };
      try {
        const task = await input.service.addJob(taskInput);
        return { content: [{ type: 'text', text: `Scheduled task created: ${task.name}` }], details: { taskId: task.id } };
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: { isError: true } };
      }
    },
  };
}

const failure = (text: string) => ({ content: [{ type: 'text', text }], details: { isError: true } });
function validateSchedule(value: unknown): { ok: true; value: ScheduledTaskInput['schedule'] } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'A valid schedule is required.' };
  const s = value as Record<string, unknown>;
  if (s.kind === ScheduleKind.At) { if (typeof s.at !== 'string' || Number.isNaN(Date.parse(s.at)) || Date.parse(s.at) <= Date.now()) return { ok: false, error: 'The one-time schedule must be a future ISO timestamp.' }; return { ok: true, value: { kind: ScheduleKind.At, at: s.at } }; }
  if (s.kind === ScheduleKind.Every) { if (typeof s.everyMs !== 'number' || !Number.isFinite(s.everyMs) || s.everyMs <= 0) return { ok: false, error: 'The interval must be a positive number.' }; return { ok: true, value: { kind: ScheduleKind.Every, everyMs: s.everyMs } }; }
  if (s.kind === ScheduleKind.Cron) { if (typeof s.expr !== 'string' || s.expr.trim().split(/\s+/).length !== 5) return { ok: false, error: 'The cron expression must contain five fields.' }; return { ok: true, value: { kind: ScheduleKind.Cron, expr: s.expr.trim() } }; }
  return { ok: false, error: 'Schedule kind must be at, every, or cron.' };
}
function validateDelivery(value?: Record<string, unknown>): { ok: true; value: NonNullable<ScheduledTaskInput['delivery']> } | { ok: false; error: string } {
  if (!value) return { ok: true, value: { mode: DeliveryMode.None } }; const mode = value.mode;
  if (mode !== DeliveryMode.None && mode !== DeliveryMode.Announce && mode !== DeliveryMode.Webhook) return { ok: false, error: 'Notification mode is invalid.' };
  if (mode === DeliveryMode.Announce && (typeof value.channel !== 'string' || !value.channel.trim() || typeof value.to !== 'string' || !value.to.trim())) return { ok: false, error: 'Announce notifications require channel and recipient.' };
  return { ok: true, value: { mode, ...(typeof value.channel === 'string' ? { channel: value.channel.trim() } : {}), ...(typeof value.to === 'string' ? { to: value.to.trim() } : {}) } };
}
