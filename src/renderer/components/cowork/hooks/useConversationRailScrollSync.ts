import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import { debounce, SCROLL_DEBOUNCE_MS } from '../../../utils/debounce';

const CONVERSATION_SCROLL_SELECTOR = '.cowork-conversation-scroll';
const BOTTOM_PROXIMITY_PX = 24;
const RAIL_ANCHOR_MIN_OFFSET_PX = 96;
const RAIL_ANCHOR_MAX_OFFSET_PX = 160;
const RAIL_ANCHOR_VIEWPORT_RATIO = 0.35;

type RailViewportMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  viewportTop: number;
};

type RailItemRect = {
  railIndex: number;
  top: number;
};

export function resolveActiveRailIndex(
  metrics: RailViewportMetrics,
  items: RailItemRect[],
): number | null {
  if (items.length === 0) return null;

  const lastItem = items[items.length - 1];
  const hiddenBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  if (hiddenBottom <= BOTTOM_PROXIMITY_PX) {
    return lastItem.railIndex;
  }

  const anchorOffset = Math.min(
    RAIL_ANCHOR_MAX_OFFSET_PX,
    Math.max(RAIL_ANCHOR_MIN_OFFSET_PX, metrics.clientHeight * RAIL_ANCHOR_VIEWPORT_RATIO),
  );
  const anchorY = metrics.viewportTop + anchorOffset;
  let activeItem = items[0];

  for (const item of items) {
    if (item.top > anchorY) break;
    activeItem = item;
  }

  return activeItem.railIndex;
}

type UseConversationRailScrollSyncOptions = {
  sessionId: string | undefined;
  rootRef: RefObject<HTMLElement | null>;
  scrollContainerRef: RefObject<HTMLElement | null>;
  currentRailIndexRef: RefObject<number>;
  isNavigatingRef: RefObject<boolean>;
  setCurrentRailIndex: Dispatch<SetStateAction<number>>;
};

export function useConversationRailScrollSync({
  sessionId,
  rootRef,
  scrollContainerRef,
  currentRailIndexRef,
  isNavigatingRef,
  setCurrentRailIndex,
}: UseConversationRailScrollSyncOptions): void {
  const syncRailIndexToScrollPosition = useCallback(() => {
    if (isNavigatingRef.current) return;

    const scrollElement = rootRef.current?.querySelector<HTMLElement>(
      CONVERSATION_SCROLL_SELECTOR,
    );
    const contentElement = scrollContainerRef.current;
    if (!scrollElement || !contentElement) return;

    const viewportRect = scrollElement.getBoundingClientRect();
    const items = Array.from(contentElement.querySelectorAll<HTMLElement>('[data-rail-index]'))
      .map(element => {
        const railIndex = Number(element.dataset.railIndex);
        if (!Number.isFinite(railIndex)) return null;
        return {
          railIndex,
          top: element.getBoundingClientRect().top,
        };
      })
      .filter((item): item is RailItemRect => item !== null);

    const nextRailIndex = resolveActiveRailIndex(
      {
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
        clientHeight: scrollElement.clientHeight,
        viewportTop: viewportRect.top,
      },
      items,
    );

    if (nextRailIndex === null || nextRailIndex === currentRailIndexRef.current) return;

    currentRailIndexRef.current = nextRailIndex;
    setCurrentRailIndex(nextRailIndex);
  }, [
    currentRailIndexRef,
    isNavigatingRef,
    rootRef,
    scrollContainerRef,
    setCurrentRailIndex,
  ]);

  // 2026/09/16 lixiang  滚动/内容尺寸变化时防抖同步轨道索引
  const scheduleSync = useMemo(
    () => debounce(syncRailIndexToScrollPosition, SCROLL_DEBOUNCE_MS),
    [syncRailIndexToScrollPosition],
  );

  useEffect(() => {
    if (!sessionId) return undefined;

    const scrollElement = rootRef.current?.querySelector<HTMLElement>(
      CONVERSATION_SCROLL_SELECTOR,
    );
    if (!scrollElement) return undefined;

    scrollElement.addEventListener('scroll', scheduleSync, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (scrollContainerRef.current) {
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(scrollContainerRef.current);
    }

    scheduleSync();

    return () => {
      scrollElement.removeEventListener('scroll', scheduleSync);
      resizeObserver?.disconnect();
      scheduleSync.cancel();
    };
  }, [rootRef, scheduleSync, scrollContainerRef, sessionId]);
}
