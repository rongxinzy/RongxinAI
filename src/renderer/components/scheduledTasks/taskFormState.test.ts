import { describe, expect, test } from 'vitest';

import { PayloadKind, SessionBindingStrategy, SessionTarget } from '../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import { buildScheduleInput, buildTaskInput, createFormState } from './taskFormState';
import type { TaskTemplateValues } from './TaskTemplateGallery';

const templatePrefill = (expr: string): TaskTemplateValues => ({
  name: '财经新闻',
  description: '每日财经要闻',
  schedule: { kind: 'cron', expr },
  promptText: '搜索今日财经要闻',
});

describe('createFormState', () => {
  test('blank task defaults to an hourly schedule', () => {
    const form = createFormState();
    expect(form.planType).toBe('hourly');
    expect(buildScheduleInput(form)).toEqual({ kind: 'cron', expr: '0 * * * *' });
  });

  test('template prefill exposes the structured plan behind its cron expr', () => {
    const daily = createFormState(undefined, templatePrefill('0 9 * * *'));
    expect(daily.planType).toBe('daily');
    expect(daily.hour).toBe(9);
    expect(daily.minute).toBe(0);
    expect(buildScheduleInput(daily)).toEqual({ kind: 'cron', expr: '0 9 * * *' });

    const hourly = createFormState(undefined, templatePrefill('30 * * * *'));
    expect(hourly.planType).toBe('hourly');
    expect(buildScheduleInput(hourly)).toEqual({ kind: 'cron', expr: '30 * * * *' });
  });

  test('template prefill keeps the cron plan when the expr has no structured form', () => {
    const form = createFormState(undefined, templatePrefill('*/15 * * * *'));
    expect(form.planType).toBe('cron');
    expect(buildScheduleInput(form)).toEqual({ kind: 'cron', expr: '*/15 * * * *' });
  });
});

function taskFixture(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'reminder',
    description: 'from template',
    enabled: false,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: 'now',
    payload: { kind: PayloadKind.AgentTurn, message: 'go' },
    delivery: { mode: 'none' },
    workspaceId: 'workspace-1',
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
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildTaskInput', () => {
  test('keeps the paused state and description of an edited task', () => {
    const task = taskFixture();
    const form = { ...createFormState(task), payloadText: 'updated prompt' };
    const input = buildTaskInput(form, { mode: 'edit', task });
    expect(input.enabled).toBe(false);
    expect(input.description).toBe('from template');
    expect(input.payload).toEqual({ kind: PayloadKind.AgentTurn, message: 'updated prompt' });
  });

  test('detaches an existing session when the binding is not session-based', () => {
    const task = taskFixture({ sessionKey: 'zhiyuan:session-1', sessionTarget: SessionTarget.Main });
    const form = {
      ...createFormState(task),
      sessionBinding: SessionBindingStrategy.PerRun,
      boundSessionId: 'session-1',
    };
    expect(buildTaskInput(form, { mode: 'edit', task }).sessionKey).toBeNull();
  });

  test('creates an enabled task with the template description', () => {
    const prefill = {
      name: 'template task',
      description: 'template description',
      schedule: { kind: 'cron', expr: '0 8 * * *' },
      promptText: 'template prompt',
    } as const;
    const form = createFormState(undefined, prefill);
    const input = buildTaskInput(form, { mode: 'create', prefill });
    expect(input.enabled).toBe(true);
    expect(input.description).toBe('template description');
  });
});
