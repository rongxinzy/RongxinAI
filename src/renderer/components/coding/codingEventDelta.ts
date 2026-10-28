import {
  CodingEventWindowPageSize,
  CodingStreamContentLengthField,
  type CodingEvent,
  type CodingRoomEventDelta,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';

const payloadShallowEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => left[key] === right[key]);
};

const eventMetaEqual = (left: CodingEvent, right: CodingEvent): boolean =>
  left.id === right.id &&
  left.laneId === right.laneId &&
  left.sequence === right.sequence &&
  left.kind === right.kind &&
  left.createdAt === right.createdAt;

const readContentLength = (payload: Record<string, unknown>): number | null => {
  const value = payload[CodingStreamContentLengthField];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const payloadWithoutStreamLength = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (!(CodingStreamContentLengthField in payload)) return payload;
  const next = { ...payload };
  delete next[CodingStreamContentLengthField];
  return next;
};

/**
 * Applies one streamed event. A `streamContentLength` frame is a suffix when
 * `content` is shorter than that length, and the full text when the lengths
 * match. A length gap keeps the event already on screen; the next snapshot
 * restores it. Identical results keep the existing object.
 */
const mergeStreamedEvent = (
  existing: CodingEvent | undefined,
  incoming: CodingEvent,
): CodingEvent | null => {
  const target = readContentLength(incoming.payload);
  const incomingContent = incoming.payload.content;
  if (target === null || typeof incomingContent !== 'string') {
    if (
      existing &&
      eventMetaEqual(existing, incoming) &&
      payloadShallowEqual(existing.payload, incoming.payload)
    ) {
      return existing;
    }
    return incoming;
  }

  const overlay = payloadWithoutStreamLength(incoming.payload);
  if (!existing) {
    if (incomingContent.length !== target) return null;
    return { ...incoming, payload: { ...overlay, content: incomingContent } };
  }

  const existingContent =
    typeof existing.payload.content === 'string' ? existing.payload.content : '';
  let nextContent: string;
  if (incomingContent.length === target) nextContent = incomingContent;
  else if (existingContent.length === target) nextContent = existingContent;
  else if (existingContent.length + incomingContent.length === target) {
    nextContent = existingContent + incomingContent;
  } else {
    return existing;
  }

  const nextPayload = { ...existing.payload, ...overlay, content: nextContent };
  const next: CodingEvent = {
    ...existing,
    sequence: incoming.sequence,
    kind: incoming.kind,
    createdAt: incoming.createdAt,
    payload: nextPayload,
  };
  if (eventMetaEqual(existing, next) && payloadShallowEqual(existing.payload, nextPayload)) {
    return existing;
  }
  return next;
};

export const mergeCodingRoomEventDelta = (
  snapshot: CodingRoomSnapshot,
  delta: CodingRoomEventDelta,
): CodingRoomSnapshot => {
  const eventsByLane = new Map<string, Map<string, CodingEvent>>();
  for (const event of snapshot.events) {
    const laneEvents = eventsByLane.get(event.laneId) ?? new Map();
    laneEvents.set(event.id, event);
    eventsByLane.set(event.laneId, laneEvents);
  }
  let changed = false;
  for (const event of delta.events) {
    const laneEvents = eventsByLane.get(event.laneId) ?? new Map();
    const merged = mergeStreamedEvent(laneEvents.get(event.id), event);
    if (!merged) continue;
    if (merged !== laneEvents.get(event.id)) changed = true;
    laneEvents.set(event.id, merged);
    eventsByLane.set(event.laneId, laneEvents);
  }
  if (!changed) return snapshot;

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
    const laneEvents = events.filter(item => item.laneId === window.laneId);
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
