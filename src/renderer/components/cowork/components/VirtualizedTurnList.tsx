import { elementScroll, useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

import type { ConversationTurn } from '../helpers/messageGrouping';

export interface VirtualizedTurnListHandle {
  scrollToTurn: (index: number) => void;
}

interface VirtualizedTurnListProps {
  isStreaming: boolean;
  turns: ConversationTurn[];
  /** Renders one turn row, including its wrapper element. */
  renderTurn: (turn: ConversationTurn, index: number) => React.ReactNode;
  /** When true (e.g. image export), every turn stays mounted for DOM capture. */
  renderAll: boolean;
}

/** Fallback height estimate for turns that were never measured. */
const TURN_HEIGHT_ESTIMATE_PX = 300;
const INITIAL_VIEWPORT_HEIGHT_PX = 1200;
const INITIAL_VIEWPORT_RECT = { width: 0, height: INITIAL_VIEWPORT_HEIGHT_PX };

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
>(({ isStreaming, turns, renderTurn, renderAll }, ref) => {
  const { scrollRef } = useStickToBottomContext();
  const hasPositionedInitialTailRef = useRef(false);
  const scrollRetryFrameRef = useRef<number | null>(null);
  const scrollRetryWindowRef = useRef<Window | null>(null);
  const scrollToFn = useCallback<typeof elementScroll>((offset, options, instance) => {
    const scrollElement = instance.scrollElement as HTMLElement | null;
    const targetWindow = scrollElement?.ownerDocument.defaultView;

    if (scrollRetryFrameRef.current !== null && scrollRetryWindowRef.current) {
      scrollRetryWindowRef.current.cancelAnimationFrame(scrollRetryFrameRef.current);
      scrollRetryFrameRef.current = null;
      scrollRetryWindowRef.current = null;
    }

    elementScroll(offset, options, instance);
    if (!scrollElement || !targetWindow || !options.adjustments) return;

    const requestedOffset = offset + options.adjustments;
    const clampedOffset = scrollElement.scrollTop;
    if (requestedOffset - clampedOffset < 1) return;

    // A ResizeObserver batch can grow several tail rows before React commits
    // the new sizer height. Retry only a browser-clamped correction after that
    // commit, and abandon it if another scroll changed the DOM position.
    scrollRetryWindowRef.current = targetWindow;
    scrollRetryFrameRef.current = targetWindow.requestAnimationFrame(() => {
      scrollRetryFrameRef.current = null;
      scrollRetryWindowRef.current = null;
      const currentScrollElement = instance.scrollElement as HTMLElement | null;
      if (currentScrollElement === scrollElement && scrollElement.scrollTop === clampedOffset) {
        scrollElement.scrollTo({ top: requestedOffset, behavior: 'auto' });
      }
    });
  }, []);
  const initialOffset = turns.length * TURN_HEIGHT_ESTIMATE_PX;
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => turns[index]?.id ?? index,
    estimateSize: () => TURN_HEIGHT_ESTIMATE_PX,
    overscan: 4,
    initialOffset,
    initialRect: INITIAL_VIEWPORT_RECT,
    anchorTo: 'end',
    followOnAppend: isStreaming ? 'auto' : false,
    scrollToFn,
  });

  useEffect(
    () => () => {
      if (scrollRetryFrameRef.current !== null && scrollRetryWindowRef.current) {
        scrollRetryWindowRef.current.cancelAnimationFrame(scrollRetryFrameRef.current);
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

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || renderAll || hasPositionedInitialTailRef.current) return;

    hasPositionedInitialTailRef.current = true;
    virtualizer.scrollToEnd({ behavior: 'auto' });
  }, [renderAll, scrollRef, virtualizer]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToTurn: index => {
        virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      },
    }),
    [virtualizer],
  );

  if (renderAll) {
    return <>{turns.map((turn, index) => renderTurn(turn, index))}</>;
  }

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtualizer.getVirtualItems().map(virtualItem => (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          ref={virtualizer.measureElement}
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
