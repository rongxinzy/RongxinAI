import { describe, expect, test } from 'vitest';

import { PayloadKind, SessionBindingStrategy, SessionTarget } from '../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import { buildTaskInput, createFormState } from './taskFormState';

describe('createFormState', () => {
  test('defaults a blank task to a daily schedule', () => {
    expect(createFormState().planType).toBe('daily');
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
