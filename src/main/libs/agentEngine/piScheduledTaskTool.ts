import type { ToolDefinition, HostToolResult } from './durableToolTypes';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from '../../../scheduledTask/constants';
import type { ScheduledTaskInput } from '../../../scheduledTask/types';

export function buildPiScheduledTaskTool(input: {
  service: ScheduledTaskService;
  workspaceId?: string | null;
}): ToolDefinition {
  return {
    name: 'scheduled_task',
    label: 'Scheduled Task',
    description:
      'Create a scheduled task in the selected workspace. Results appear in the local workbench and task execution records.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short task name.' },
        description: { type: 'string', description: 'What the task does.' },
        schedule: {
          type: 'object',
          description:
            'Schedule: {kind:"at",at} or {kind:"cron",expr,tz} or {kind:"every",everyMs}.',
        },
        message: { type: 'string', description: 'Prompt executed when the task runs.' },
      },
      required: ['name', 'schedule', 'message'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, rawParams: unknown) => {
      const params =
        rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
          ? (rawParams as Record<string, unknown>)
          : {};
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      const message = typeof params.message === 'string' ? params.message.trim() : '';
      const schedule = params.schedule;
      if (!name || !message || !schedule || typeof schedule !== 'object') {
        return failure('Task name, schedule, and message are required.');
      }
      const normalizedSchedule = validateSchedule(schedule);
      if (normalizedSchedule.ok === false) return failure(normalizedSchedule.error);
      const taskInput: ScheduledTaskInput = {
        name,
        description: typeof params.description === 'string' ? params.description.trim() : message,
        enabled: true,
        schedule: normalizedSchedule.value,
        sessionTarget: SessionTarget.Isolated,
        wakeMode: WakeMode.Now,
        payload: { kind: PayloadKind.AgentTurn, message },
        delivery: { mode: DeliveryMode.None },
        workspaceId: input.workspaceId ?? null,
        sessionKey: null,
      };
      try {
        const task = await input.service.addJob(taskInput);
        return {
          content: [{ type: 'text', text: `Scheduled task created: ${task.name}` }],
          details: { taskId: task.id },
        };
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

const failure = (text: string): HostToolResult => ({
  content: [{ type: 'text', text }],
  details: { isError: true },
  isError: true,
});
function validateSchedule(
  value: unknown,
): { ok: true; value: ScheduledTaskInput['schedule'] } | { ok: false; error: string } {
  if (!value || typeof value !== 'object')
    return { ok: false, error: 'A valid schedule is required.' };
  const s = value as Record<string, unknown>;
  if (s.kind === ScheduleKind.At) {
    if (
      typeof s.at !== 'string' ||
      Number.isNaN(Date.parse(s.at)) ||
      Date.parse(s.at) <= Date.now()
    )
      return { ok: false, error: 'The one-time schedule must be a future ISO timestamp.' };
    return { ok: true, value: { kind: ScheduleKind.At, at: s.at } };
  }
  if (s.kind === ScheduleKind.Every) {
    if (typeof s.everyMs !== 'number' || !Number.isSafeInteger(s.everyMs) || s.everyMs <= 0)
      return { ok: false, error: 'The interval must be a positive number.' };
    return {
      ok: true,
      value: {
        kind: ScheduleKind.Every,
        everyMs: s.everyMs,
        ...(typeof s.anchorMs === 'number' ? { anchorMs: s.anchorMs } : {}),
      },
    };
  }
  if (s.kind === ScheduleKind.Cron) {
    if (typeof s.expr !== 'string' || s.expr.trim().split(/\s+/).length !== 5)
      return { ok: false, error: 'The cron expression must contain five fields.' };
    return {
      ok: true,
      value: {
        kind: ScheduleKind.Cron,
        expr: s.expr.trim(),
        ...(typeof s.tz === 'string' ? { tz: s.tz.trim() } : {}),
        ...(typeof s.staggerMs === 'number' ? { staggerMs: s.staggerMs } : {}),
      },
    };
  }
  return { ok: false, error: 'Schedule kind must be at, every, or cron.' };
}
