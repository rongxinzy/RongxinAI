import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {
  CodingAgentLane,
  CodingEventPage,
  CodingRoomSnapshot,
} from '../../../shared/codingAgent';

interface UseCodingEventHistoryOptions {
  workspaceRoot: string;
  snapshot: CodingRoomSnapshot | null;
  activeLane: CodingAgentLane | null;
  setSnapshot: Dispatch<SetStateAction<CodingRoomSnapshot | null>>;
  eventStreamRef: RefObject<HTMLDivElement | null>;
}

/**
 * Loads older event pages for the active lane and restores the lane's saved
 * scroll position when the active lane id changes.
 */
export function useCodingEventHistory({
  workspaceRoot,
  snapshot,
  activeLane,
  setSnapshot,
  eventStreamRef,
}: UseCodingEventHistoryOptions) {
  const activeLaneId = activeLane?.id ?? null;
  const loadingOlderEventsRef = useRef(false);

  // The activeLane object is re-created on every streamed snapshot update, so
  // an effect keyed on it would re-assign viewport.scrollTop on each streamed
  // event — overriding the stick-to-bottom auto-scroll and making the viewport
  // jump away from the latest message. Restore the saved scroll position only
  // when the lane id actually changes (lane switch or initial load).
  const activeLaneSnapshotRef = useRef(activeLane);
  activeLaneSnapshotRef.current = activeLane;
  const restoredScrollLaneRef = useRef<string | null>(null);
  useEffect(() => {
    const lane = activeLaneSnapshotRef.current;
    if (!lane) return;
    if (restoredScrollLaneRef.current === lane.id) return;
    restoredScrollLaneRef.current = lane.id;
    const frame = requestAnimationFrame(() => {
      const viewport = eventStreamRef.current?.querySelector<HTMLElement>(
        '.coding-conversation-scroll',
      );
      if (viewport) viewport.scrollTop = lane.scrollPosition;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeLane?.id, eventStreamRef]);

  const loadOlderEvents = useCallback(async () => {
    if (!activeLaneId || loadingOlderEventsRef.current) return;
    const windowInfo = snapshot?.eventWindows?.find(window => window.laneId === activeLaneId);
    if (!windowInfo?.hasMore || windowInfo.oldestSequence === null) return;
    loadingOlderEventsRef.current = true;
    const viewport = eventStreamRef.current?.querySelector<HTMLElement>(
      '.coding-conversation-scroll',
    );
    const distanceFromBottom = viewport ? viewport.scrollHeight - viewport.scrollTop : null;
    try {
      const result = await window.electron.codingAgent.loadEventPage({
        workspaceRoot,
        laneId: activeLaneId,
        beforeSequence: windowInfo.oldestSequence,
      });
      const page: CodingEventPage | undefined = result.success ? result.page : undefined;
      if (!page) return;
      setSnapshot(current => {
        if (!current) return current;
        const eventsById = new Map(current.events.map(event => [event.id, event]));
        for (const event of page.events) eventsById.set(event.id, event);
        const events = [...eventsById.values()].sort((left, right) =>
          left.laneId === right.laneId
            ? left.sequence - right.sequence
            : left.laneId.localeCompare(right.laneId),
        );
        const eventWindows = (current.eventWindows ?? []).map(window =>
          window.laneId === page.laneId
            ? {
                ...window,
                oldestSequence: page.events[0]?.sequence ?? window.oldestSequence,
                hasMore: page.hasMore,
              }
            : window,
        );
        return { ...current, events, eventWindows };
      });
      if (distanceFromBottom !== null) {
        requestAnimationFrame(() => {
          const nextViewport = eventStreamRef.current?.querySelector<HTMLElement>(
            '.coding-conversation-scroll',
          );
          if (nextViewport) nextViewport.scrollTop = nextViewport.scrollHeight - distanceFromBottom;
        });
      }
    } finally {
      loadingOlderEventsRef.current = false;
    }
  }, [activeLaneId, eventStreamRef, setSnapshot, snapshot?.eventWindows, workspaceRoot]);

  return { loadOlderEvents };
}
