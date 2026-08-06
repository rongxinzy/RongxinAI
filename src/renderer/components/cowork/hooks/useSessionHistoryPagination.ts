import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { coworkService } from '../../../services/cowork';

const HISTORY_SCROLL_THRESHOLD_PX = 64;

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

    const handleScroll = () => {
      if (element.scrollTop <= HISTORY_SCROLL_THRESHOLD_PX) {
        loadOlderMessages();
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });

    // If the first page does not fill the viewport, there may be no scroll
    // event. Keep loading until the viewport can expose the older history.
    if (element.scrollHeight <= element.clientHeight && messagesOffset > 0) {
      loadOlderMessages();
    }

    return () => element.removeEventListener('scroll', handleScroll);
  }, [messagesOffset, positionedSessionId, rootRef, sessionId]);

  return markInitialTailPositioned;
}
