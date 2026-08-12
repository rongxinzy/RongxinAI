import { expect, test } from 'vitest';

import { ChannelRunStatus, ChannelRunTrigger } from '../../../shared/channelRun/constants';
import type { ChannelRunSummary } from '../../../shared/channelRun/constants';
import activityReducer, { clearChannelRuns, recordChannelRun } from './activitySlice';

const summary = (overrides: Partial<ChannelRunSummary> = {}): ChannelRunSummary => ({
  runId: 'run-1',
  sessionId: 'session-1',
  platform: 'feishu',
  conversationId: 'conv-1',
  trigger: ChannelRunTrigger.Channel,
  status: ChannelRunStatus.Started,
  timestamp: 1,
  ...overrides,
});

test('records run events newest-first and keeps the latest transition', () => {
  const started = activityReducer(
    undefined,
    recordChannelRun(summary({ trigger: ChannelRunTrigger.Cron })),
  );
  const completed = activityReducer(
    started,
    recordChannelRun(summary({ status: ChannelRunStatus.Completed, timestamp: 2 })),
  );

  expect(completed.channelRuns).toHaveLength(2);
  expect(completed.channelRuns[0]?.status).toBe(ChannelRunStatus.Completed);
  expect(completed.channelRuns[1]?.status).toBe(ChannelRunStatus.Started);
});

test('caps each trigger at 50 rendered runs', () => {
  let state = activityReducer(undefined, { type: 'init' });
  for (let i = 0; i < 75; i++) {
    state = activityReducer(
      state,
      recordChannelRun(summary({ runId: `channel-${i}`, timestamp: i })),
    );
    state = activityReducer(
      state,
      recordChannelRun(
        summary({
          runId: `cron-${i}`,
          trigger: ChannelRunTrigger.Cron,
          timestamp: i,
        }),
      ),
    );
  }

  expect(state.channelRuns).toHaveLength(100);
  expect(
    state.channelRuns.filter(event => event.trigger === ChannelRunTrigger.Channel),
  ).toHaveLength(50);
  expect(state.channelRuns.filter(event => event.trigger === ChannelRunTrigger.Cron)).toHaveLength(
    50,
  );
});

test('keeps at most one started and one terminal event for each retained run', () => {
  let state = activityReducer(undefined, { type: 'init' });
  state = activityReducer(state, recordChannelRun(summary()));
  for (let timestamp = 2; timestamp <= 100; timestamp += 1) {
    state = activityReducer(
      state,
      recordChannelRun(summary({ status: ChannelRunStatus.Completed, timestamp })),
    );
  }

  expect(state.channelRuns).toHaveLength(2);
  expect(state.channelRuns[0]).toMatchObject({
    status: ChannelRunStatus.Completed,
    timestamp: 100,
  });
  expect(state.channelRuns[1]?.status).toBe(ChannelRunStatus.Started);
});

test('keeps a strict event bound when retained runs have full lifecycles', () => {
  let state = activityReducer(undefined, { type: 'init' });
  for (let i = 0; i < 75; i += 1) {
    for (const trigger of [ChannelRunTrigger.Channel, ChannelRunTrigger.Cron]) {
      const runId = `${trigger}-${i}`;
      state = activityReducer(
        state,
        recordChannelRun(summary({ runId, trigger, timestamp: i * 2 })),
      );
      state = activityReducer(
        state,
        recordChannelRun(
          summary({
            runId,
            trigger,
            status: ChannelRunStatus.Completed,
            timestamp: i * 2 + 1,
          }),
        ),
      );
    }
  }

  expect(state.channelRuns).toHaveLength(200);
});

test('clearChannelRuns empties the projection', () => {
  const withRuns = activityReducer(undefined, recordChannelRun(summary()));
  const cleared = activityReducer(withRuns, clearChannelRuns());

  expect(cleared.channelRuns).toEqual([]);
});
