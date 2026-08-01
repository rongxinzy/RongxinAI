import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ChannelRunSummary } from '../../../shared/channelRun/constants';

/** Bound on how many Channel/Cron run events stay in memory. */
const CHANNEL_RUN_HISTORY_LIMIT = 200;

export interface ActivityState {
  /**
   * Read-only projection of Channel/Cron run lifecycle events, newest
   * first (issue #225). These are OpenClaw-domain runs — they never become
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
      if (state.channelRuns.length > CHANNEL_RUN_HISTORY_LIMIT) {
        state.channelRuns.length = CHANNEL_RUN_HISTORY_LIMIT;
      }
    },
    clearChannelRuns(state) {
      state.channelRuns = [];
    },
  },
});

export const { recordChannelRun, clearChannelRuns } = activitySlice.actions;
export default activitySlice.reducer;
