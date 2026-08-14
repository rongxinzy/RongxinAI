import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ActivityRun } from '../../../shared/activity/types';
import { shouldAcceptActivityUpdate } from '../../../shared/activity/ordering';

export interface ActivityState {
  runs: ActivityRun[];
}

const initialState: ActivityState = {
  runs: [],
};

const activitySlice = createSlice({
  name: 'activity',
  initialState,
  reducers: {
    hydrateRuns(state, action: PayloadAction<ActivityRun[]>) {
      const byId = new Map(state.runs.map(run => [run.id, run]));
      for (const run of action.payload) {
        const current = byId.get(run.id);
        if (!current || shouldAcceptActivityUpdate(current, run)) byId.set(run.id, run);
      }
      state.runs = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    upsertRun(state, action: PayloadAction<ActivityRun>) {
      const index = state.runs.findIndex(run => run.id === action.payload.id);
      if (index >= 0) {
        if (!shouldAcceptActivityUpdate(state.runs[index], action.payload)) return;
        state.runs[index] = action.payload;
      }
      else state.runs.push(action.payload);
      state.runs.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  },
});

export const { hydrateRuns, upsertRun } = activitySlice.actions;
export default activitySlice.reducer;
