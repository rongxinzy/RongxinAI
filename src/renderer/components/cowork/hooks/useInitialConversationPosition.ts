import { type RefObject, useLayoutEffect } from 'react';

const CONVERSATION_SCROLL_SELECTOR = '.cowork-conversation-scroll';

type UseInitialConversationPositionOptions = {
  sessionId: string | undefined;
  rootRef: RefObject<HTMLElement | null>;
};

export function useInitialConversationPosition({
  sessionId,
  rootRef,
}: UseInitialConversationPositionOptions): void {
  useLayoutEffect(() => {
    if (!sessionId) return;

    const scrollElement = rootRef.current?.querySelector<HTMLElement>(
      CONVERSATION_SCROLL_SELECTOR,
    );
    if (!scrollElement) return;

    const previousScrollBehavior = scrollElement.style.scrollBehavior;
    scrollElement.style.scrollBehavior = 'auto';
    scrollElement.scrollTop = scrollElement.scrollHeight;
    scrollElement.style.scrollBehavior = previousScrollBehavior;
  }, [rootRef, sessionId]);
}
