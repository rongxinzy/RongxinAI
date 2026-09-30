import { CodingEventKind, type CodingEvent } from '../../shared/codingAgent';
import { getCodingEventText } from '../components/coding/codingEventProjection';
import { appErrorText } from './appErrorText';
import { showAppToast } from './appToast';

const observedByLane = new Map<string, number>();

/** Shared by mounted history and the app-wide subscription, so neither repeats a failure. */
export function observeCodingTurnFailures(events: CodingEvent[], liveSince?: number): void {
  const byLane = new Map<string, CodingEvent[]>();
  for (const event of events) {
    const list = byLane.get(event.laneId);
    if (list) list.push(event);
    else byLane.set(event.laneId, [event]);
  }
  for (const [laneId, laneEvents] of byLane) {
    const maxSequence = laneEvents.reduce((max, event) => Math.max(max, event.sequence), 0);
    const baseline = observedByLane.get(laneId);
    observedByLane.set(laneId, Math.max(baseline ?? 0, maxSequence));
    for (const event of laneEvents) {
      if (
        baseline === undefined
          ? liveSince === undefined || event.createdAt < liveSince
          : event.sequence <= baseline
      )
        continue;
      if (event.kind !== CodingEventKind.TurnFailed) continue;
      showAppToast(appErrorText(getCodingEventText(event), 'codingAgentTurnFailed'), {
        isError: true,
      });
    }
  }
}

/** Stays mounted when the user switches away from coding or to another workspace. */
export function startCodingFailureNoticeListener(): () => void {
  const startedAt = Date.now();
  const stopSnapshots = window.electron.codingAgent.onChanged(snapshot => {
    observeCodingTurnFailures(snapshot.events, startedAt);
  });
  const stopDeltas = window.electron.codingAgent.onEventDelta(delta => {
    observeCodingTurnFailures(delta.events, startedAt);
  });
  return () => {
    stopSnapshots();
    stopDeltas();
  };
}
