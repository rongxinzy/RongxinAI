import { describe, expect, it } from 'vitest';

import {
  ChannelRunStatus,
  ChannelRunTrigger,
  type ChannelRunSummary,
} from '../../../shared/channelRun/constants';
import type { RootState } from '../index';
import {
  foldChannelRunEvents,
  selectActivityRuns,
  selectHasActiveChannelRun,
} from './activitySelectors';

let eventCounter = 0;

const makeEvent = (overrides: Partial<ChannelRunSummary>): ChannelRunSummary => {
  eventCounter += 1;
  return {
    sessionId: `session-${eventCounter}`,
    platform: 'feishu',
    conversationId: 'conv-1',
    trigger: ChannelRunTrigger.Channel,
    status: ChannelRunStatus.Started,
    timestamp: 1_000_000 + eventCounter * 1_000,
    ...overrides,
  };
};

const stateWith = (channelRuns: ChannelRunSummary[]): RootState =>
  ({ activity: { channelRuns } }) as RootState;

describe('foldChannelRunEvents', () => {
  it('folds a started/completed pair into one run with the terminal status', () => {
    const started = makeEvent({ sessionId: 's1', inputPreview: 'hello' });
    const completed = makeEvent({
      sessionId: 's1',
      status: ChannelRunStatus.Completed,
      timestamp: started.timestamp + 500,
      replyPreview: 'world',
    });
    // Store order is newest first.
    const runs = foldChannelRunEvents([completed, started]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sessionId: 's1',
      status: ChannelRunStatus.Completed,
      inputPreview: 'hello',
      replyPreview: 'world',
      startedAt: started.timestamp,
      updatedAt: completed.timestamp,
    });
  });

  it('keeps a lone started event as a running run', () => {
    const started = makeEvent({ sessionId: 's1' });
    const runs = foldChannelRunEvents([started]);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe(ChannelRunStatus.Started);
  });

  it('treats repeated runs on the same session as separate runs', () => {
    const first = makeEvent({ sessionId: 's1', inputPreview: 'one' });
    const firstDone = makeEvent({
      sessionId: 's1',
      status: ChannelRunStatus.Completed,
      timestamp: first.timestamp + 100,
    });
    const second = makeEvent({
      sessionId: 's1',
      inputPreview: 'two',
      timestamp: first.timestamp + 200,
    });
    const runs = foldChannelRunEvents([second, firstDone, first]);
    expect(runs).toHaveLength(2);
    // Newest run first; the second run is still waiting for its terminal event.
    expect(runs[0]).toMatchObject({ inputPreview: 'two', status: ChannelRunStatus.Started });
    expect(runs[1]).toMatchObject({ inputPreview: 'one', status: ChannelRunStatus.Completed });
  });

  it('keeps a terminal event whose started event is missing as its own run', () => {
    const failed = makeEvent({
      sessionId: 's1',
      status: ChannelRunStatus.Failed,
      errorMessage: 'boom',
    });
    const runs = foldChannelRunEvents([failed]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: ChannelRunStatus.Failed,
      errorMessage: 'boom',
    });
  });

  it('returns runs newest first', () => {
    const older = makeEvent({ sessionId: 's1' });
    const newer = makeEvent({ sessionId: 's2', timestamp: older.timestamp + 10_000 });
    const runs = foldChannelRunEvents([newer, older]);
    expect(runs.map(run => run.sessionId)).toEqual(['s2', 's1']);
  });

  it('generates unique ids for runs on the same session', () => {
    const first = makeEvent({ sessionId: 's1' });
    const firstDone = makeEvent({
      sessionId: 's1',
      status: ChannelRunStatus.Completed,
      timestamp: first.timestamp + 100,
    });
    const second = makeEvent({ sessionId: 's1', timestamp: first.timestamp + 200 });
    const runs = foldChannelRunEvents([second, firstDone, first]);
    expect(new Set(runs.map(run => run.id)).size).toBe(runs.length);
  });
});

describe('selectActivityRuns', () => {
  it('memoizes the folded result for an unchanged event array', () => {
    const events = [makeEvent({ sessionId: 's1' })];
    const state = stateWith(events);
    expect(selectActivityRuns(state)).toBe(selectActivityRuns(state));
  });
});

describe('selectHasActiveChannelRun', () => {
  it('is true while any run is still running', () => {
    const started = makeEvent({ sessionId: 's1' });
    expect(selectHasActiveChannelRun(stateWith([started]))).toBe(true);
  });

  it('is false once every run reached a terminal status', () => {
    const started = makeEvent({ sessionId: 's1' });
    const completed = makeEvent({
      sessionId: 's1',
      status: ChannelRunStatus.Completed,
      timestamp: started.timestamp + 100,
    });
    expect(selectHasActiveChannelRun(stateWith([completed, started]))).toBe(false);
  });

  it('is false for an empty feed', () => {
    expect(selectHasActiveChannelRun(stateWith([]))).toBe(false);
  });
});
