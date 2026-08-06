import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { coworkService } from '../../../services/cowork';

const HISTORY_SCROLL_THRESHOLD_PX = 64;
const HISTORY_PRELOAD_VIEWPORTS = 3;

type UseSessionHistoryPaginationOptions = {
  sessionId: string | undefined;
  messagesOffset: number;
  rootRef: RefObject<HTMLElement | null>;
};

/** Primes and extends older history while preserving an upward viewport buffer. */
export function useSessionHistoryPagination({
  sessionId,
  messagesOffset,
  rootRef,
}: UseSessionHistoryPaginationOptions): () => void {
  const isLoadingRef = useRef(false);
  const loadingOffsetRef = useRef<number | null>(null);
  const prefetchedSessionIdRef = useRef<string | null>(null);
  const [positionedSessionId, setPositionedSessionId] = useState<string | null>(null);
  const markInitialTailPositioned = useCallback(() => {
    setPositionedSessionId(sessionId ?? null);
  }, [sessionId]);

  useEffect(() => {
    isLoadingRef.current = false;
    loadingOffsetRef.current = null;
    prefetchedSessionIdRef.current = null;
    setPositionedSessionId(null);
  }, [sessionId]);

  useEffect(() => {
    if (loadingOffsetRef.current === null || messagesOffset >= loadingOffsetRef.current) return;

    isLoadingRef.current = false;
    loadingOffsetRef.current = null;
  }, [messagesOffset]);

  useEffect(() => {
    if (!sessionId || messagesOffset <= 0) return;

    const root = rootRef.current;
    const element = root?.querySelector<HTMLElement>('.cowork-conversation-scroll');
    if (!element) return;

    const loadOlderMessages = () => {
      if (isLoadingRef.current || messagesOffset <= 0) return;

      isLoadingRef.current = true;
      loadingOffsetRef.current = messagesOffset;

      void coworkService
        .loadMoreMessages(sessionId)
        .then(loaded => {
          if (!loaded) {
            isLoadingRef.current = false;
            loadingOffsetRef.current = null;
          }
        })
        .catch(error => {
          isLoadingRef.current = false;
          loadingOffsetRef.current = null;
          console.error('[CoworkHistory] failed to load older messages:', error);
        });
    };

    const getPreloadThreshold = () =>
      Math.max(HISTORY_SCROLL_THRESHOLD_PX, element.clientHeight * HISTORY_PRELOAD_VIEWPORTS);

    const shouldLoadForViewport = () => {
      const preloadThreshold = getPreloadThreshold();
      if (positionedSessionId === sessionId) {
        return element.scrollTop <= preloadThreshold;
      }

      // Before the initial tail position settles, prime enough history to
      // make upward scrolling available immediately. This check uses total
      // scroll range because scrollTop is still moving toward the tail.
      return Math.max(element.scrollHeight - element.clientHeight, 0) < preloadThreshold;
    };

    const handleScroll = () => {
      if (shouldLoadForViewport()) {
        loadOlderMessages();
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });

    // Start one history request immediately instead of waiting for the tail
    // measurement loop. Later pages wait for two frames so the virtualizer can
    // measure and anchor the page before the buffer is evaluated again.
    if (prefetchedSessionIdRef.current !== sessionId) {
      prefetchedSessionIdRef.current = sessionId;
      loadOlderMessages();
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(handleScroll);
    });

    return () => {
      element.removeEventListener('scroll', handleScroll);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [messagesOffset, positionedSessionId, rootRef, sessionId]);

  return markInitialTailPositioned;
}
