import { expect, test } from 'vitest';

import { ChannelRunStatus, ChannelRunTrigger } from '../../../shared/channelRun/constants';
import type { ChannelRunSummary } from '../../../shared/channelRun/constants';
import activityReducer, { clearChannelRuns, recordChannelRun } from './activitySlice';

const summary = (overrides: Partial<ChannelRunSummary> = {}): ChannelRunSummary => ({
  sessionId: 'session-1',
  platform: 'feishu',
  conversationId: 'conv-1',
  trigger: ChannelRunTrigger.Channel,
  status: ChannelRunStatus.Started,
  timestamp: 1,
  ...overrides,
});

test('records run events newest-first and keeps the latest transition', () => {
  const started = activityReducer(undefined, recordChannelRun(summary()));
  const completed = activityReducer(
    started,
    recordChannelRun(summary({ status: ChannelRunStatus.Completed, timestamp: 2 })),
  );

  expect(completed.channelRuns).toHaveLength(2);
  expect(completed.channelRuns[0]?.status).toBe(ChannelRunStatus.Completed);
  expect(completed.channelRuns[1]?.status).toBe(ChannelRunStatus.Started);
});

test('caps the history at 200 entries', () => {
  let state = activityReducer(undefined, { type: 'init' });
  for (let i = 0; i < 250; i++) {
    state = activityReducer(state, recordChannelRun(summary({ timestamp: i })));
  }

  expect(state.channelRuns).toHaveLength(200);
  expect(state.channelRuns[0]?.timestamp).toBe(249);
});

test('clearChannelRuns empties the projection', () => {
  const withRuns = activityReducer(undefined, recordChannelRun(summary()));
  const cleared = activityReducer(withRuns, clearChannelRuns());

  expect(cleared.channelRuns).toEqual([]);
});
