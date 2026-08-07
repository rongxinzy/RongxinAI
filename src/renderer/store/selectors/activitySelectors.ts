import { createSelector } from '@reduxjs/toolkit';

import {
  ChannelRunStatus,
  ChannelRunTrigger,
  type ChannelRunSummary,
} from '../../../shared/channelRun/constants';
import type { RootState } from '../index';

/**
 * One aggregated Channel/Cron run. The activity slice stores raw lifecycle
 * events (started → completed/failed); the feed folds them by run ID so one
 * run renders as a single row whose status updates in place (issue #225).
 */
export interface ActivityRun {
  /** Stable run identity supplied by the main-process execution boundary. */
  id: string;
  sessionId: string;
  platform: string;
  conversationId: string;
  trigger: ChannelRunTrigger;
  status: ChannelRunStatus;
  taskName?: string;
  /** Timestamp of the started event (or of the first seen event). */
  startedAt: number;
  /** Timestamp of the latest lifecycle transition. */
  updatedAt: number;
  inputPreview?: string;
  replyPreview?: string;
  errorMessage?: string;
}

const toRun = (event: ChannelRunSummary): ActivityRun => ({
  id: event.runId,
  sessionId: event.sessionId,
  platform: event.platform,
  conversationId: event.conversationId,
  trigger: event.trigger,
  status: event.status,
  taskName: event.taskName,
  startedAt: event.timestamp,
  updatedAt: event.timestamp,
  inputPreview: event.inputPreview,
  replyPreview: event.replyPreview,
  errorMessage: event.errorMessage,
});

/**
 * Fold the raw event stream into aggregated runs, newest first. Events are
 * stored newest-first, so the fold walks oldest-first: a started event opens
 * a fresh run and a terminal event closes that exact run. A session may see
 * several requests over time (or a replacement while one is still active),
 * so sessionId alone is not a valid lifecycle identity.
 */
export const foldChannelRunEvents = (events: ChannelRunSummary[]): ActivityRun[] => {
  const runs: ActivityRun[] = [];
  const runById = new Map<string, ActivityRun>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    // Ignore legacy/background-delivery Cron starts that carried neither a
    // task name nor input. They are not actionable activity records.
    if (
      event.trigger === ChannelRunTrigger.Cron &&
      event.status === ChannelRunStatus.Started &&
      !event.taskName &&
      !event.inputPreview
    ) {
      continue;
    }
    let run = runById.get(event.runId);
    if (!run && event.status !== ChannelRunStatus.Started) {
      // Some channel adapters emit the start and terminal lifecycle events
      // from different boundaries. When there is exactly one matching active
      // channel run, merge the terminal event even if its runId differs.
      let candidates = runs.filter(
        candidate =>
          candidate.trigger === ChannelRunTrigger.Channel &&
          candidate.status === ChannelRunStatus.Started &&
          event.trigger === ChannelRunTrigger.Channel &&
          candidate.sessionId === event.sessionId &&
          candidate.platform === event.platform &&
          (!candidate.conversationId ||
            !event.conversationId ||
            candidate.conversationId === event.conversationId),
      );
      if (candidates.length === 1) {
        run = candidates[0];
        runById.set(event.runId, run);
      }
    }
    if (!run) {
      run = toRun(event);
      runs.push(run);
      runById.set(event.runId, run);
    }
    if (event.status === ChannelRunStatus.Started) {
      continue;
    }
    run.status = event.status;
    run.updatedAt = event.timestamp;
    if (event.sessionId) run.sessionId = event.sessionId;
    if (event.conversationId) run.conversationId = event.conversationId;
    run.replyPreview = event.replyPreview ?? run.replyPreview;
    run.errorMessage = event.errorMessage ?? run.errorMessage;
  }
  return runs.reverse();
};

const selectChannelRunEvents = (state: RootState) => state.activity.channelRuns;

export const selectActivityRuns = createSelector(selectChannelRunEvents, foldChannelRunEvents);

/** Drives the small live indicator on the sidebar activity entry. */
export const selectHasActiveChannelRun = createSelector(selectActivityRuns, runs =>
  runs.some(run => run.status === ChannelRunStatus.Started),
);
