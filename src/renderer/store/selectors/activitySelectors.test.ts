import { describe, expect, it } from 'vitest';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import type { ActivityRun } from '../../../shared/activity/types';
import type { RootState } from '../index';
import { selectActivityRuns, selectHasActiveActivityRun } from './activitySelectors';

const run = (overrides: Partial<ActivityRun> = {}): ActivityRun => ({
  id: 'run-1', source: ActivitySource.Channel, status: ActivityStatus.Running,
  startedAt: 1, updatedAt: 1, ...overrides,
});
const stateWith = (runs: ActivityRun[]): RootState => ({ activity: { runs } } as unknown as RootState);

describe('activity selectors', () => {
  it('returns the durable activity list without folding lifecycle events', () => {
    const state = stateWith([run({ id: 'completed', status: ActivityStatus.Completed }), run({ id: 'scheduled', source: ActivitySource.ScheduledTask })]);
    expect(selectActivityRuns(state)).toHaveLength(2);
    expect(selectActivityRuns(state)).toBe(selectActivityRuns(state));
  });

  it('reports activity while any unified run is in progress', () => {
    expect(selectHasActiveActivityRun(stateWith([run({ status: ActivityStatus.Completed }), run()]))).toBe(true);
    expect(selectHasActiveActivityRun(stateWith([run({ status: ActivityStatus.Failed })]))).toBe(false);
  });
});
