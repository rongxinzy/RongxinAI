import { type RefObject, useLayoutEffect } from 'react';

const CONVERSATION_SCROLL_SELECTOR = '.cowork-conversation-scroll';

type UseScrollStabilizationOptions = {
  sessionId: string | undefined;
  isStreaming: boolean;
  rootRef: RefObject<HTMLElement | null>;
};

/**
 * Pins the conversation scroll position to the bottom on session mount.
 *
 * Without this, the virtualized turn list renders with estimated heights
 * (300 px / turn) at scrollTop = 0 — the user sees the top for one frame
 * before stick-to-bottom's ResizeObserver fires and scrolls down.  Native
 * scroll anchoring then silently drifts scrollTop as estimates are replaced
 * by real measurements.
 *
 * The hook:
 * 1. Disables overflow-anchor so the browser doesn't fight us.
 * 2. Sets scrollTop = scrollHeight in a layout effect (before paint).
 * 3. Re-applies after two rAFs to cover virtualizer measurement re-renders
 *    and any late-arriving stick-to-bottom corrections.
 *
 * Streaming sessions are skipped — their height changes continuously and
 * stick-to-bottom's smooth resize handles them correctly.
 */
export function useScrollStabilization({
  sessionId,
  isStreaming,
  rootRef,
}: UseScrollStabilizationOptions): void {
  useLayoutEffect(() => {
    if (!sessionId || isStreaming) return;

    const scrollEl = rootRef.current?.querySelector<HTMLElement>(
      CONVERSATION_SCROLL_SELECTOR,
    );
    if (!scrollEl) return;

    scrollEl.style.overflowAnchor = 'none';
    scrollEl.style.scrollBehavior = 'auto';
    scrollEl.scrollTop = scrollEl.scrollHeight;

    let raf = requestAnimationFrame(() => {
      scrollEl.style.scrollBehavior = 'auto';
      scrollEl.scrollTop = scrollEl.scrollHeight;

      raf = requestAnimationFrame(() => {
        scrollEl.style.scrollBehavior = 'auto';
        scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [sessionId, isStreaming, rootRef]);
}
