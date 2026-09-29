import { useEffect } from 'react';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { appErrorText } from '../../services/appErrorText';
import { showAppToast } from '../../services/appToast';
import { getCodingEventText } from './codingEventProjection';

/**
 * Highest event sequence already accounted for, per lane.
 *
 * Module scope on purpose: a failed turn must still reach the user when the
 * failure happened while the coding view was unmounted (another page open) or
 * while another lane was selected. A per-mount ref would treat that failure as
 * news it had already seen — or as pre-existing history — and stay silent.
 *
 * Only the high-water mark is kept: lanes stream thousands of events over a
 * desktop session, and the set of ids is not worth its memory.
 */
const observedByLane = new Map<string, number>();

/**
 * Mirror a failed coding turn to the app-wide prompt.
 *
 * The conversation keeps the failure line as history (DESIGN.md keeps durable
 * state in the page); the prompt is what makes the failure noticeable when the
 * user is looking somewhere else — most importantly for external agents, which
 * report an unusable credential by answering a prompt with nothing at all.
 */
export const useTurnFailureToast = (events: CodingEvent[]): void => {
  useEffect(() => {
    const byLane = new Map<string, CodingEvent[]>();
    for (const event of events) {
      const list = byLane.get(event.laneId);
      if (list) list.push(event);
      else byLane.set(event.laneId, [event]);
    }

    for (const [laneId, laneEvents] of byLane) {
      const maxSequence = laneEvents.reduce((max, event) => Math.max(max, event.sequence), 0);
      const baseline = observedByLane.get(laneId);
      if (baseline === undefined) {
        // First sighting of this lane: its history is not news. Anything the
        // lane reports afterwards is.
        observedByLane.set(laneId, maxSequence);
        continue;
      }
      observedByLane.set(laneId, Math.max(baseline, maxSequence));
      for (const event of laneEvents) {
        if (event.sequence <= baseline) continue;
        if (event.kind !== CodingEventKind.TurnFailed) continue;
        showAppToast(appErrorText(getCodingEventText(event), 'codingAgentTurnFailed'), {
          isError: true,
        });
      }
    }
  }, [events]);
};
