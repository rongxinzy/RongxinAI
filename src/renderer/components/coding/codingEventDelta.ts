import {
  CodingEventWindowPageSize,
  type CodingRoomEventDelta,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';

export const mergeCodingRoomEventDelta = (
  snapshot: CodingRoomSnapshot,
  delta: CodingRoomEventDelta,
): CodingRoomSnapshot => {
  const eventsByLane = new Map<string, Map<string, (typeof snapshot.events)[number]>>();
  for (const event of snapshot.events) {
    const laneEvents = eventsByLane.get(event.laneId) ?? new Map();
    laneEvents.set(event.id, event);
    eventsByLane.set(event.laneId, laneEvents);
  }
  for (const event of delta.events) {
    const laneEvents = eventsByLane.get(event.laneId) ?? new Map();
    laneEvents.set(event.id, event);
    eventsByLane.set(event.laneId, laneEvents);
  }

  const laneEventLists = [...eventsByLane.values()].map(laneEvents =>
    [...laneEvents.values()].sort((left, right) => left.sequence - right.sequence),
  );
  const events = laneEventLists
    .flatMap(laneEvents => laneEvents.slice(-CodingEventWindowPageSize))
    .sort((left, right) =>
      left.laneId === right.laneId
        ? left.sequence - right.sequence
        : left.laneId.localeCompare(right.laneId),
    );
  const eventWindows = (snapshot.eventWindows ?? []).map(window => {
    const laneEvents = events.filter(event => event.laneId === window.laneId);
    return {
      ...window,
      oldestSequence: laneEvents[0]?.sequence ?? window.oldestSequence,
      newestSequence: laneEvents.at(-1)?.sequence ?? window.newestSequence,
      hasMore:
        window.hasMore ||
        (laneEventLists.find(laneEvents => laneEvents[0]?.laneId === window.laneId)?.length ?? 0) >
          CodingEventWindowPageSize,
    };
  });
  return { ...snapshot, events, eventWindows };
};
