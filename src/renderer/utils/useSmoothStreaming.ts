import { useCallback, useEffect, useRef, useState } from 'react';

/** Characters per second — comfortable reading speed for CJK. */
const CHARS_PER_SECOND = 120;
/** ~30fps tick interval. */
const TICK_MS = 33;
const CHARS_PER_TICK = Math.max(1, Math.round(CHARS_PER_SECOND / (1000 / TICK_MS)));

/**
 * Drip-feeds text at a steady pace during streaming.
 * Renders the full content immediately once streaming finishes.
 */
export function useSmoothStreaming(rawContent: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(rawContent);
  const rawRef = useRef(rawContent);
  rawRef.current = rawContent;
  const displayedRef = useRef(rawContent);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTicking = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      const target = rawRef.current;
      const cur = displayedRef.current;
      if (cur.length >= target.length) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      const next = target.slice(0, cur.length + CHARS_PER_TICK);
      displayedRef.current = next;
      setDisplayed(next);
    }, TICK_MS);
  }, []);

  // Start/stop based on streaming state
  useEffect(() => {
    if (!isStreaming) {
      // Done — flush full content, stop timer.
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDisplayed(rawRef.current);
      displayedRef.current = rawRef.current;
      return;
    }
    // Streaming — reset and start drip-feed.
    displayedRef.current = '';
    setDisplayed('');
    startTicking();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isStreaming, startTicking]);

  // When new content arrives and the timer has caught up, restart it.
  useEffect(() => {
    if (!isStreaming) return;
    if (!timerRef.current && displayedRef.current.length < rawContent.length) {
      startTicking();
    }
  }, [rawContent, isStreaming, startTicking]);

  return displayed;
}
