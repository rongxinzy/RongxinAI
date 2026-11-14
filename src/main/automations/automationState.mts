import { defineDoc, type JsonObject } from '@earendil-works/pi-durable';
import type { ScheduledTask, ScheduledTaskRunWithName } from '../../scheduledTask/types.js';

export const AutomationEntry = { Run: 'zhiyuan.automation.run' } as const;
export const AutomationTaskKind = {
  Schedule: 'zhiyuan.automation.schedule',
  Run: 'zhiyuan.automation.run',
  Deadline: 'zhiyuan.automation.deadline',
} as const;

export type AutomationState = {
  job: JsonObject | null;
  revision: number;
  scheduler: number | null;
  active: number | null;
  activeError: string | null;
  stopEpoch: number;
  runCount: number;
  removed: boolean;
  parkedError: string | null;
};

/** All definition and projection changes commit on the native execution line. */
export const AutomationDoc = defineDoc<AutomationState>({
  kind: 'zhiyuan.automation',
  scope: 'session',
  version: 1,
  initial: () => ({
    job: null,
    revision: 0,
    scheduler: null,
    active: null,
    activeError: null,
    stopEpoch: 0,
    runCount: 0,
    removed: false,
    parkedError: null,
  }),
  checkpointWhen: () => true,
});

export function jobJson(job: ScheduledTask): JsonObject {
  return JSON.parse(JSON.stringify(job)) as JsonObject;
}

export function readJob(value: Readonly<AutomationState> | undefined): ScheduledTask | null {
  if (!value?.job || value.removed) return null;
  const job = JSON.parse(JSON.stringify(value.job)) as ScheduledTask;
  if (value.parkedError) job.state.lastError = value.parkedError;
  return job;
}

export function runJson(run: ScheduledTaskRunWithName): JsonObject {
  return JSON.parse(JSON.stringify(run)) as JsonObject;
}

export function automationSessionId(id: string): string {
  return `automation:${id}`;
}
