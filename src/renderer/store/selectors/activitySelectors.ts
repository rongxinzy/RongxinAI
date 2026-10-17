import { createSelector } from '@reduxjs/toolkit';

import { ActivityStatus } from '../../../shared/activity/constants';
import type { ActivityRun } from '../../../shared/activity/types';
import type { RootState } from '../index';

export type { ActivityRun };
export const selectActivityRuns = (state: RootState): ActivityRun[] => state.activity.runs;

/** Drives the small live indicator on the sidebar activity entry. */
export const selectHasActiveActivityRun = createSelector(selectActivityRuns, runs =>
  runs.some(run => run.status === ActivityStatus.Running),
);
