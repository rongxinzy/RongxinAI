import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { coworkService } from '../../../services/cowork';

const HISTORY_SCROLL_THRESHOLD_PX = 64;
const HISTORY_PRELOAD_VIEWPORTS = 2;

type UseSessionHistoryPaginationOptions = {
  sessionId: string | undefined;
  messagesOffset: number;
  rootRef: RefObject<HTMLElement | null>;
};

/** Loads older messages when the conversation viewport reaches its top edge. */
export function useSessionHistoryPagination({
  sessionId,
  messagesOffset,
  rootRef,
}: UseSessionHistoryPaginationOptions): () => void {
  const isLoadingRef = useRef(false);
  const loadingOffsetRef = useRef<number | null>(null);
  const [positionedSessionId, setPositionedSessionId] = useState<string | null>(null);
  const markInitialTailPositioned = useCallback(() => {
    setPositionedSessionId(sessionId ?? null);
  }, [sessionId]);

  useEffect(() => {
    isLoadingRef.current = false;
    loadingOffsetRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (loadingOffsetRef.current === null || messagesOffset >= loadingOffsetRef.current) return;

    isLoadingRef.current = false;
    loadingOffsetRef.current = null;
  }, [messagesOffset]);

  useEffect(() => {
    if (!sessionId || positionedSessionId !== sessionId || messagesOffset <= 0) return;

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

    const handleScroll = () => {
      if (element.scrollTop <= getPreloadThreshold()) {
        loadOlderMessages();
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });

    // Wait for the virtualizer to measure and anchor a prepended page before
    // checking the buffer again. Continue only while fewer than two viewports
    // remain above the user, keeping the initial tail page small and immediate.
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
