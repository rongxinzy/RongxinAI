import { createSelector } from '@reduxjs/toolkit';

import {
  ChannelRunStatus,
  type ChannelRunSummary,
  type ChannelRunTrigger,
} from '../../../shared/channelRun/constants';
import type { RootState } from '../index';

/**
 * One aggregated Channel/Cron run. The activity slice stores raw lifecycle
 * events (started → completed/failed); the feed folds them by session so one
 * run renders as a single row whose status updates in place (issue #225).
 */
export interface ActivityRun {
  /** Stable React key: sessionId + first-seen timestamp. */
  id: string;
  sessionId: string;
  platform: string;
  conversationId: string;
  trigger: ChannelRunTrigger;
  status: ChannelRunStatus;
  /** Timestamp of the started event (or of the first seen event). */
  startedAt: number;
  /** Timestamp of the latest lifecycle transition. */
  updatedAt: number;
  inputPreview?: string;
  replyPreview?: string;
  errorMessage?: string;
}

const toRun = (event: ChannelRunSummary): ActivityRun => ({
  id: `${event.sessionId}:${event.timestamp}`,
  sessionId: event.sessionId,
  platform: event.platform,
  conversationId: event.conversationId,
  trigger: event.trigger,
  status: event.status,
  startedAt: event.timestamp,
  updatedAt: event.timestamp,
  inputPreview: event.inputPreview,
  replyPreview: event.replyPreview,
  errorMessage: event.errorMessage,
});

/**
 * Fold the raw event stream into aggregated runs, newest first. Events are
 * stored newest-first, so the fold walks oldest-first: a started event opens
 * a fresh run and a terminal event closes the most recent open run of the
 * same session (one conversation sees many runs over time).
 */
export const foldChannelRunEvents = (events: ChannelRunSummary[]): ActivityRun[] => {
  const runs: ActivityRun[] = [];
  const openRunBySession = new Map<string, ActivityRun>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.status === ChannelRunStatus.Started) {
      const run = toRun(event);
      runs.push(run);
      openRunBySession.set(event.sessionId, run);
      continue;
    }
    const openRun = openRunBySession.get(event.sessionId);
    if (openRun) {
      openRun.status = event.status;
      openRun.updatedAt = event.timestamp;
      openRun.replyPreview = event.replyPreview ?? openRun.replyPreview;
      openRun.errorMessage = event.errorMessage ?? openRun.errorMessage;
      openRunBySession.delete(event.sessionId);
    } else {
      // Terminal event whose started event fell out of the history window.
      runs.push(toRun(event));
    }
  }
  return runs.reverse();
};

const selectChannelRunEvents = (state: RootState) => state.activity.channelRuns;

export const selectActivityRuns = createSelector(selectChannelRunEvents, foldChannelRunEvents);

/** Drives the small live indicator on the sidebar activity entry. */
export const selectHasActiveChannelRun = createSelector(selectActivityRuns, runs =>
  runs.some(run => run.status === ChannelRunStatus.Started),
);
