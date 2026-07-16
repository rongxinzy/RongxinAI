import { type RefObject,useEffect, useLayoutEffect, useRef } from 'react';

import { coworkService } from '../../../services/cowork';

const HISTORY_SCROLL_THRESHOLD_PX = 64;

type ScrollSnapshot = {
  element: HTMLElement;
  previousHeight: number;
  previousOffset: number;
  previousTop: number;
};

type UseSessionHistoryPaginationOptions = {
  sessionId: string | undefined;
  messagesOffset: number;
  messageCount: number;
  rootRef: RefObject<HTMLElement | null>;
};

/** Loads older messages when the conversation viewport reaches its top edge. */
export function useSessionHistoryPagination({
  sessionId,
  messagesOffset,
  messageCount,
  rootRef,
}: UseSessionHistoryPaginationOptions): void {
  const isLoadingRef = useRef(false);
  const snapshotRef = useRef<ScrollSnapshot | null>(null);

  useEffect(() => {
    isLoadingRef.current = false;
    snapshotRef.current = null;
  }, [sessionId]);

  useLayoutEffect(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot || messagesOffset >= snapshot.previousOffset) return;

    snapshotRef.current = null;
    const frameId = window.requestAnimationFrame(() => {
      if (snapshot.element.isConnected) {
        const heightDelta = snapshot.element.scrollHeight - snapshot.previousHeight;
        snapshot.element.scrollTop = snapshot.previousTop + heightDelta;
      }
      isLoadingRef.current = false;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [messageCount, messagesOffset]);

  useEffect(() => {
    if (!sessionId || messagesOffset <= 0) return;

    const root = rootRef.current;
    const element = root?.querySelector<HTMLElement>('.cowork-conversation-scroll');
    if (!element) return;

    const loadOlderMessages = () => {
      if (isLoadingRef.current || messagesOffset <= 0) return;

      isLoadingRef.current = true;
      snapshotRef.current = {
        element,
        previousHeight: element.scrollHeight,
        previousOffset: messagesOffset,
        previousTop: element.scrollTop,
      };

      void coworkService.loadMoreMessages(sessionId).then((loaded) => {
        if (!loaded) {
          snapshotRef.current = null;
          isLoadingRef.current = false;
        }
      }).catch((error) => {
        snapshotRef.current = null;
        isLoadingRef.current = false;
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
  }, [messagesOffset, rootRef, sessionId]);
}
