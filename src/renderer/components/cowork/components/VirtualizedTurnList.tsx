import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useImperativeHandle, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

import type { ConversationTurn } from '../helpers/messageGrouping';

export interface VirtualizedTurnListHandle {
  scrollToTurn: (index: number) => void;
}

interface VirtualizedTurnListProps {
  turns: ConversationTurn[];
  /** Renders one turn row, including its wrapper element. */
  renderTurn: (turn: ConversationTurn, index: number) => React.ReactNode;
  /** When true (e.g. image export), every turn stays mounted for DOM capture. */
  renderAll: boolean;
}

/** Fallback height estimate for turns that were never measured. */
const TURN_HEIGHT_ESTIMATE_PX = 300;

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
>(({ turns, renderTurn, renderAll }, ref) => {
  const { scrollRef } = useStickToBottomContext();
  const measuredSizesRef = useRef(new Map<React.Key, number>());
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => turns[index]?.id ?? index,
    estimateSize: index =>
      measuredSizesRef.current.get(turns[index]?.id ?? index) ?? TURN_HEIGHT_ESTIMATE_PX,
    overscan: 4,
  });

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
          ref={element => {
            virtualizer.measureElement(element);
            if (element) {
              measuredSizesRef.current.set(virtualItem.key, element.getBoundingClientRect().height);
            }
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          {renderTurn(turns[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
});

VirtualizedTurnList.displayName = 'VirtualizedTurnList';
