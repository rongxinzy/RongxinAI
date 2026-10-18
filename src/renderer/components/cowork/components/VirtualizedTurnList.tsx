import { elementScroll, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import { useConversationViewportContext } from '@shared/components/ai-elements/useConversationViewport';

import { estimateCachedTurnHeight } from '../helpers/cachedTurnHeight';
import { getConversationTurnMessageIds, type ConversationTurn } from '../helpers/messageGrouping';

export interface VirtualizedTurnListHandle {
  scrollToTurn: (index: number) => void;
}

interface VirtualizedTurnListProps {
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

const syncMeasuredTurnLayout = <TScrollElement extends Element, TItemElement extends Element>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  sizer: HTMLDivElement | null,
) => {
  if (!sizer) return;

  sizer.style.height = `${instance.getTotalSize()}px`;
  for (const item of instance.getVirtualItems()) {
    const element = instance.elementsCache.get(item.key) as HTMLElement | undefined;
    if (element) element.style.top = `${item.start}px`;
  }
};

/**
 * Renders only the visible window of conversation turns (issue #141
 * Phase 3). Turn identity comes from stable turn ids, measured heights are
 * remembered per turn, and the virtualizer is the single owner of the
 * viewport's scroll position: every write goes through its scroll pipeline
 * (anchor + follow-on-append adjustments included). While `renderAll` is set
 * the list renders every turn so DOM-based export capture keeps working.
 */
export const VirtualizedTurnList = React.forwardRef<
  VirtualizedTurnListHandle,
  VirtualizedTurnListProps
>(({ turns, onInitialTailPositioned, renderTurn, renderAll }, ref) => {
  const { getScrollElement, registerScrollWriter } = useConversationViewportContext();
  const hasPositionedInitialTailRef = useRef(false);
  const followedTailEdgesRef = useRef<{ first?: string; last?: string } | null>(null);
  const virtualSizerRef = useRef<HTMLDivElement>(null);
  const measuredTurnSizesRef = useRef(new Map<string, number>());
  const previousMessageIdsByTurnRef = useRef(new Map<string, string[]>());
  const measureElementRefsRef = useRef(
    new Map<React.Key, (element: HTMLDivElement | null) => void>(),
  );
  const tailRetryFrameRef = useRef<number | null>(null);
  const tailRetryWindowRef = useRef<Window | null>(null);
  const tailRetryCleanupRef = useRef<(() => void) | null>(null);
  const estimatedTurnSizes = useMemo(() => turns.map(estimateCachedTurnHeight), [turns]);

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
    const maxScroll = scrollElement
      ? Math.max(scrollElement.scrollHeight - scrollElement.clientHeight, 0)
      : 0;
    const wasAtTail = scrollElement ? Math.abs(scrollElement.scrollTop - maxScroll) < 1 : false;
    const requestedOffset = offset + (options.adjustments ?? 0);

    // TanStack updates its size cache before requesting scroll compensation,
    // but notifies onChange afterwards. Grow the DOM first so the browser does
    // not clamp that compensation to the previous height for one painted frame.
    syncMeasuredTurnLayout(instance, virtualSizerRef.current);
    elementScroll(offset, options, instance);
    if (!scrollElement || !targetWindow) return;

    // Upward anchor adjustments stay short of the end and must not schedule a
    // later scroll write.
    const totalSize = typeof instance.getTotalSize === 'function' ? instance.getTotalSize() : null;
    const virtualizerMaxScroll =
      totalSize !== null ? Math.max(totalSize - scrollElement.clientHeight, 0) : null;
    const seeksTail =
      wasAtTail ||
      requestedOffset >= maxScroll - 1 ||
      (virtualizerMaxScroll !== null && requestedOffset >= virtualizerMaxScroll - 1);
    if (!seeksTail && options.behavior === undefined) return;
    const clampedOffset = scrollElement.scrollTop;
    if (requestedOffset - clampedOffset < 1) return;

    // A tail-seeking write can still be clamped to the stale content height
    // during mounting (the sizer grows later in the same commit). Retry once
    // on the next frame; the retry only runs when nothing else moved the
    // scroll position in between.
    if (tailRetryFrameRef.current !== null && tailRetryWindowRef.current) {
      tailRetryWindowRef.current.cancelAnimationFrame(tailRetryFrameRef.current);
    }
    const cleanup = () => {
      tailRetryFrameRef.current = null;
      tailRetryWindowRef.current = null;
    };
    scrollElement.addEventListener('scroll', cleanup, { once: true, passive: true });
    tailRetryWindowRef.current = targetWindow;
    tailRetryFrameRef.current = targetWindow.requestAnimationFrame(() => {
      const frame = tailRetryFrameRef.current;
      tailRetryFrameRef.current = null;
      tailRetryWindowRef.current = null;
      if (frame === null) return;
      scrollElement.removeEventListener('scroll', cleanup);
      const currentScrollElement = instance.scrollElement as HTMLElement | null;
      if (currentScrollElement === scrollElement && scrollElement.scrollTop === clampedOffset) {
        scrollElement.scrollTo({ top: requestedOffset, behavior: 'auto' });
      }
    });
    tailRetryCleanupRef.current = () => {
      targetWindow.cancelAnimationFrame(tailRetryFrameRef.current ?? 0);
      scrollElement.removeEventListener('scroll', cleanup);
      cleanup();
    };
  }, []);
  const initialOffset = estimatedTurnSizes.reduce((total, size) => total + size, 0);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement,
    getItemKey: index => turns[index]?.id ?? index,
    estimateSize: index => estimatedTurnSizes[index] ?? 300,
    overscan: TURN_OVERSCAN,
    initialOffset,
    initialRect: INITIAL_VIEWPORT_RECT,
    // 2026/09/16 lixiang  贴底时条目增高由 virtualizer 直接补偿 scrollTop，勿再额外 scrollToEnd（防抖只会滞后跳动）
    anchorTo: 'end',
    followOnAppend: true,
    scrollToFn,
    onChange: instance => {
      // Also synchronize measurements that do not require a scroll adjustment.
      syncMeasuredTurnLayout(instance, virtualSizerRef.current);
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

  // The virtualizer owns the viewport's scroll position: route the follow
  // hook's "scroll to bottom" through it instead of a second writer.
  const scrollToEnd = useCallback(() => {
    virtualizer.scrollToEnd({ behavior: 'auto' });
  }, [virtualizer]);
  useEffect(() => registerScrollWriter(scrollToEnd), [registerScrollWriter, scrollToEnd]);

  useEffect(
    () => () => {
      tailRetryCleanupRef.current?.();
      tailRetryCleanupRef.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement) return;

    const previousOverflowAnchor = scrollElement.style.overflowAnchor;
    scrollElement.style.overflowAnchor = 'none';

    return () => {
      scrollElement.style.overflowAnchor = previousOverflowAnchor;
    };
  }, [getScrollElement]);

  useLayoutEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement) return;

    const rows = scrollElement.querySelectorAll<HTMLElement>('[data-turn-key]');
    for (const row of rows) {
      const key = row.dataset.turnKey;
      if (!key) continue;

      const height = row.offsetHeight;
      const previousSize = internallyPrependedTurnSizes.get(key);
      if (previousSize !== undefined && virtualizer.scrollDirection === 'backward') {
        const delta = height - previousSize;
        const rowStart = Number.parseFloat(row.style.top);
        if (delta > 0 && rowStart <= scrollElement.scrollTop) {
          scrollElement.scrollTop += delta;
        }
      }
      // A retained row's ref does not run again when a history page fills it.
      // Measure it in this commit, before new-row corrections and tail alignment
      // can leave an overflowing row outside the virtualizer's cached geometry.
      virtualizer.resizeItem(virtualizer.indexFromElement(row), height);
      measuredTurnSizesRef.current.set(key, height);
    }
    previousMessageIdsByTurnRef.current = nextMessageIdsByTurn;
  }, [internallyPrependedTurnSizes, nextMessageIdsByTurn, getScrollElement, turns, virtualizer]);

  // 仅首次定位到底；同一次数的流式增高交给 anchorTo:end。
  // 首屏还在跟随底部时，历史消息前插会换掉首条 id 但末条不变，followOnAppend 不会补滚。
  useLayoutEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement || renderAll) {
      return;
    }

    const firstId = turns[0]?.id;
    const lastId = turns[turns.length - 1]?.id;
    const previousEdges = followedTailEdgesRef.current;
    const historyPrepended =
      previousEdges !== null && firstId !== previousEdges.first && lastId === previousEdges.last;
    if (hasPositionedInitialTailRef.current && !historyPrepended) {
      return;
    }

    virtualizer.scrollToEnd({ behavior: 'auto' });
    hasPositionedInitialTailRef.current = true;
    followedTailEdgesRef.current = { first: firstId, last: lastId };
    if (!historyPrepended) onInitialTailPositioned?.();
  }, [onInitialTailPositioned, renderAll, getScrollElement, turns, virtualizer]);

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
    <div
      data-virtualized-turn-list
      ref={virtualSizerRef}
      style={{
        height: virtualizer.getTotalSize(),
        position: 'relative',
        width: '100%',
        // Geometry must be immediate even under global reduced-motion resets.
        transitionProperty: 'none',
      }}
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
            transitionProperty: 'none',
          }}
        >
          {renderTurn(turns[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
});

VirtualizedTurnList.displayName = 'VirtualizedTurnList';
