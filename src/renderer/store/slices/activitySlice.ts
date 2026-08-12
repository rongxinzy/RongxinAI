import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  ChannelRunStatus,
  type ChannelRunSummary,
  type ChannelRunTrigger,
} from '../../../shared/channelRun/constants';

/** Bound on how many rendered runs stay in memory for each trigger. */
const RUN_HISTORY_LIMIT_PER_TRIGGER = 50;

export interface ActivityState {
  /**
   * Read-only projection of Channel/Cron run lifecycle events, newest
   * first (issue #225). These are Channel/Cron runs; they never become
   * cowork sessions; the activity feed only displays them.
   */
  channelRuns: ChannelRunSummary[];
}

const initialState: ActivityState = {
  channelRuns: [],
};

const activitySlice = createSlice({
  name: 'activity',
  initialState,
  reducers: {
    recordChannelRun(state, action: PayloadAction<ChannelRunSummary>) {
      state.channelRuns.unshift(action.payload);

      const retainedRunIds = new Set<string>();
      const retainedStartedRunIds = new Set<string>();
      const retainedTerminalRunIds = new Set<string>();
      const counts = new Map<ChannelRunTrigger, number>();
      const retainedEvents: ChannelRunSummary[] = [];
      for (const event of state.channelRuns) {
        const runKey = `${event.trigger}:${event.runId}`;
        if (!retainedRunIds.has(runKey)) {
          const count = counts.get(event.trigger) ?? 0;
          if (count >= RUN_HISTORY_LIMIT_PER_TRIGGER) continue;
          retainedRunIds.add(runKey);
          counts.set(event.trigger, count + 1);
        }

        if (event.status === ChannelRunStatus.Started) {
          if (retainedStartedRunIds.has(runKey)) continue;
          retainedStartedRunIds.add(runKey);
        } else {
          if (retainedTerminalRunIds.has(runKey)) continue;
          retainedTerminalRunIds.add(runKey);
        }
        retainedEvents.push(event);
      }
      state.channelRuns = retainedEvents;
    },
    clearChannelRuns(state) {
      state.channelRuns = [];
    },
  },
});

export const { recordChannelRun, clearChannelRuns } = activitySlice.actions;
export default activitySlice.reducer;
