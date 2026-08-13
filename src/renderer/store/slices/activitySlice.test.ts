import { expect, test } from 'vitest';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import type { ActivityRun } from '../../../shared/activity/types';
import activityReducer, { hydrateRuns, upsertRun } from './activitySlice';

const run = (overrides: Partial<ActivityRun> = {}): ActivityRun => ({
  id: 'run-1', source: ActivitySource.Channel, status: ActivityStatus.Running,
  startedAt: 1, updatedAt: 1, ...overrides,
});

test('hydrates durable activity runs newest-first', () => {
  const state = activityReducer(undefined, hydrateRuns([run({ id: 'older', updatedAt: 1 }), run({ id: 'newer', updatedAt: 2 })]));
  expect(state.runs.map(item => item.id)).toEqual(['newer', 'older']);
});

test('merges a realtime update by stable run identity', () => {
  const started = activityReducer(undefined, upsertRun(run()));
  const completed = activityReducer(started, upsertRun(run({ status: ActivityStatus.Completed, updatedAt: 2, replyPreview: 'done' })));
  expect(completed.runs).toEqual([expect.objectContaining({ id: 'run-1', status: ActivityStatus.Completed, replyPreview: 'done' })]);
});

test('ignores stale realtime updates and preserves the terminal state', () => {
  const completed = activityReducer(undefined, upsertRun(run({ status: ActivityStatus.Completed, updatedAt: 20, replyPreview: 'done' })));
  const stale = activityReducer(completed, upsertRun(run({ status: ActivityStatus.Running, updatedAt: 10 })));
  expect(stale.runs[0]).toMatchObject({ status: ActivityStatus.Completed, updatedAt: 20, replyPreview: 'done' });
});

test('hydration does not overwrite a newer realtime event', () => {
  const live = activityReducer(undefined, upsertRun(run({ status: ActivityStatus.Completed, updatedAt: 20 })));
  const merged = activityReducer(live, hydrateRuns([run({ status: ActivityStatus.Running, updatedAt: 10 })]));
  expect(merged.runs[0]).toMatchObject({ status: ActivityStatus.Completed, updatedAt: 20 });
});
