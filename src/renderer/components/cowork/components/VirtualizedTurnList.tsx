import { elementScroll, useVirtualizer } from '@tanstack/react-virtual';
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

import { estimateConversationTurnHeight } from '../helpers/conversationTurnHeight';
import { getConversationTurnMessageIds, type ConversationTurn } from '../helpers/messageGrouping';

export interface VirtualizedTurnListHandle {
  scrollToTurn: (index: number) => void;
}

interface VirtualizedTurnListProps {
  isStreaming: boolean;
  turns: ConversationTurn[];
  onInitialTailPositioned?: () => void;
  /** Renders one turn row, including its wrapper element. */
  renderTurn: (turn: ConversationTurn, index: number) => React.ReactNode;
  /** When true (e.g. image export), every turn stays mounted for DOM capture. */
  renderAll: boolean;
}

const INITIAL_VIEWPORT_HEIGHT_PX = 1200;
const INITIAL_VIEWPORT_RECT = { width: 0, height: INITIAL_VIEWPORT_HEIGHT_PX };
const TURN_OVERSCAN = 8;

/**
 * Renders only the visible window of conversation turns (issue #141
 * Phase 3). Turn identity comes from stable turn ids, measured heights are
 * remembered per turn, and the stick-to-bottom scroll context provides the
 * scroll element. While `renderAll` is set the list renders every turn so
 * DOM-based export capture keeps working.
 */
export const VirtualizedTurnList = React.forwardRef<
  VirtualizedTurnListHandle,
  VirtualizedTurnListProps
>(({ isStreaming, turns, onInitialTailPositioned, renderTurn, renderAll }, ref) => {
  const { scrollRef } = useStickToBottomContext();
  const hasPositionedInitialTailRef = useRef(false);
  const shouldFollowInitialTailRef = useRef(true);
  const virtualSizerRef = useRef<HTMLDivElement>(null);
  const measuredTurnSizesRef = useRef(new Map<string, number>());
  const previousMessageIdsByTurnRef = useRef(new Map<string, string[]>());
  const measureElementRefsRef = useRef(
    new Map<React.Key, (element: HTMLDivElement | null) => void>(),
  );
  const tailRetryFrameRef = useRef<number | null>(null);
  const tailRetryWindowRef = useRef<Window | null>(null);
  const estimatedTurnSizes = useMemo(() => turns.map(estimateConversationTurnHeight), [turns]);

  const { internallyPrependedTurnSizes, nextMessageIdsByTurn } = useMemo(() => {
    const nextIdsByTurn = new Map<string, string[]>();
    const prependedSizes = new Map<string, number>();
    for (const turn of turns) {
      const nextMessageIds = getConversationTurnMessageIds(turn);
      const previousMessageIds = previousMessageIdsByTurnRef.current.get(turn.id);
      if (previousMessageIds?.[0] && nextMessageIds.indexOf(previousMessageIds[0]) > 0) {
        const previousSize = measuredTurnSizesRef.current.get(turn.id);
        if (previousSize !== undefined) {
          prependedSizes.set(turn.id, previousSize);
        }
      }
      nextIdsByTurn.set(turn.id, nextMessageIds);
    }
    return {
      internallyPrependedTurnSizes: prependedSizes,
      nextMessageIdsByTurn: nextIdsByTurn,
    };
  }, [turns]);
  const scrollToFn = useCallback<typeof elementScroll>((offset, options, instance) => {
    const scrollElement = instance.scrollElement as HTMLElement | null;
    const targetWindow = scrollElement?.ownerDocument.defaultView;
    const wasAtTail = scrollElement
      ? Math.abs(
          scrollElement.scrollTop -
            Math.max(scrollElement.scrollHeight - scrollElement.clientHeight, 0),
        ) < 1
      : false;

    elementScroll(offset, options, instance);
    if (!scrollElement || !targetWindow) return;

    // Internal anchor adjustments during upward scrolling must never schedule
    // a later scroll write. Retry only a clamped tail update or an explicit
    // programmatic scroll such as the initial jump to the end.
    if (!wasAtTail && options.behavior === undefined) return;

    const requestedOffset = offset + (options.adjustments ?? 0);
    const clampedOffset = scrollElement.scrollTop;
    if (requestedOffset - clampedOffset < 1) return;

    if (tailRetryFrameRef.current !== null && tailRetryWindowRef.current) {
      tailRetryWindowRef.current.cancelAnimationFrame(tailRetryFrameRef.current);
    }

    tailRetryWindowRef.current = targetWindow;
    tailRetryFrameRef.current = targetWindow.requestAnimationFrame(() => {
      tailRetryFrameRef.current = null;
      tailRetryWindowRef.current = null;
      const currentScrollElement = instance.scrollElement as HTMLElement | null;
      if (currentScrollElement === scrollElement && scrollElement.scrollTop === clampedOffset) {
        scrollElement.scrollTo({ top: requestedOffset, behavior: 'auto' });
      }
    });
  }, []);
  const initialOffset = estimatedTurnSizes.reduce((total, size) => total + size, 0);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => turns[index]?.id ?? index,
    estimateSize: index => estimatedTurnSizes[index] ?? 300,
    overscan: TURN_OVERSCAN,
    initialOffset,
    initialRect: INITIAL_VIEWPORT_RECT,
    anchorTo: 'end',
    followOnAppend: isStreaming ? 'auto' : false,
    scrollToFn,
    onChange: instance => {
      // ResizeObserver corrections happen before React can commit the new
      // virtual positions. Apply the sizer height and mounted row offsets in
      // that same callback so the corrected scrollTop and layout reach the
      // browser together instead of painting a transient frame.
      const sizer = virtualSizerRef.current;
      if (!sizer) return;

      sizer.style.height = `${instance.getTotalSize()}px`;
      for (const item of instance.getVirtualItems()) {
        const element = instance.elementsCache.get(item.key) as HTMLElement | undefined;
        if (element) element.style.top = `${item.start}px`;
      }
    },
  });
  const getMeasureElementRef = useCallback(
    (key: React.Key) => {
      const existing = measureElementRefsRef.current.get(key);
      if (existing) return existing;

      const measure = (element: HTMLDivElement | null) => {
        virtualizer.measureElement(element);
        if (element) measuredTurnSizesRef.current.set(String(key), element.offsetHeight);
      };
      measureElementRefsRef.current.set(key, measure);
      return measure;
    },
    [virtualizer],
  );

  useEffect(
    () => () => {
      if (tailRetryFrameRef.current !== null && tailRetryWindowRef.current) {
        tailRetryWindowRef.current.cancelAnimationFrame(tailRetryFrameRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const previousOverflowAnchor = scrollElement.style.overflowAnchor;
    scrollElement.style.overflowAnchor = 'none';

    return () => {
      scrollElement.style.overflowAnchor = previousOverflowAnchor;
    };
  }, [scrollRef]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const ownerDocument = scrollElement?.ownerDocument;
    if (!scrollElement || !ownerDocument) return;

    const stopFollowingInitialTail = () => {
      shouldFollowInitialTailRef.current = false;
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stopFollowingInitialTail();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'Home', 'PageUp'].includes(event.key)) {
        stopFollowingInitialTail();
      }
    };

    scrollElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollElement.addEventListener('touchstart', stopFollowingInitialTail, { passive: true });
    scrollElement.addEventListener('pointerdown', stopFollowingInitialTail, { passive: true });
    ownerDocument.addEventListener('keydown', handleKeyDown);

    return () => {
      scrollElement.removeEventListener('wheel', handleWheel);
      scrollElement.removeEventListener('touchstart', stopFollowingInitialTail);
      scrollElement.removeEventListener('pointerdown', stopFollowingInitialTail);
      ownerDocument.removeEventListener('keydown', handleKeyDown);
    };
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const rows = scrollElement.querySelectorAll<HTMLElement>('[data-turn-key]');
    for (const row of rows) {
      const key = row.dataset.turnKey;
      if (!key) continue;

      const previousSize = internallyPrependedTurnSizes.get(key);
      if (previousSize !== undefined && virtualizer.scrollDirection === 'backward') {
        const delta = row.offsetHeight - previousSize;
        const rowStart = Number.parseFloat(row.style.top);
        if (delta > 0 && rowStart <= scrollElement.scrollTop) {
          scrollElement.scrollTop += delta;
        }
      }
      measuredTurnSizesRef.current.set(key, row.offsetHeight);
    }
    previousMessageIdsByTurnRef.current = nextMessageIdsByTurn;
  }, [internallyPrependedTurnSizes, nextMessageIdsByTurn, scrollRef, turns, virtualizer]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || renderAll || !shouldFollowInitialTailRef.current) return;

    virtualizer.scrollToEnd({ behavior: 'auto' });
    if (!hasPositionedInitialTailRef.current) {
      hasPositionedInitialTailRef.current = true;
      onInitialTailPositioned?.();
    }
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToTurn: index => {
        shouldFollowInitialTailRef.current = false;
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      },
    }),
    [virtualizer],
  );

  if (renderAll) {
    return <>{turns.map((turn, index) => renderTurn(turn, index))}</>;
  }

  return (
    <div
      data-virtualized-turn-list
      ref={virtualSizerRef}
      style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
    >
      {virtualizer.getVirtualItems().map(virtualItem => (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          data-turn-key={String(virtualItem.key)}
          ref={getMeasureElementRef(virtualItem.key)}
          style={{
            position: 'absolute',
            top: virtualItem.start,
            left: 0,
            width: '100%',
          }}
        >
          {renderTurn(turns[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
});

VirtualizedTurnList.displayName = 'VirtualizedTurnList';
