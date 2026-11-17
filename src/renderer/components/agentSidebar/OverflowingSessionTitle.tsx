import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@shared/lib/utils';

import { getSessionTitleMarqueeMetrics } from './sessionTitleMarqueeMetrics';
import type { SessionTitleMarqueeMetrics } from './sessionTitleMarqueeMetrics';

interface SessionTitleMarqueeProps {
  title: string;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const HOVER_MARQUEE_DELAY_MS = 550;

const OverflowingSessionTitle: React.FC<SessionTitleMarqueeProps> = ({ title }) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const movingTextRef = useRef<HTMLSpanElement>(null);
  const isHoveredRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<SessionTitleMarqueeMetrics | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const stopMarquee = useCallback(() => {
    clearHoverTimer();
    isAnimatingRef.current = false;
    setMetrics(null);
  }, [clearHoverTimer]);

  const startMarquee = useCallback(() => {
    const viewport = viewportRef.current;
    const movingText = movingTextRef.current;
    if (!viewport || !movingText || prefersReducedMotion()) {
      isAnimatingRef.current = false;
      setMetrics(null);
      return;
    }

    const next = getSessionTitleMarqueeMetrics(
      viewport.getBoundingClientRect().width,
      movingText.getBoundingClientRect().width,
    );
    isAnimatingRef.current = next !== null;
    setMetrics(next);
  }, []);

  const scheduleMarquee = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      if (isHoveredRef.current) startMarquee();
    }, HOVER_MARQUEE_DELAY_MS);
  }, [clearHoverTimer, startMarquee]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      // Only recalculate when marquee has already started; avoid jumping
      // immediately when hover-revealed row actions shrink the title slot.
      if (isHoveredRef.current && isAnimatingRef.current) startMarquee();
    });
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [startMarquee]);

  useEffect(() => {
    stopMarquee();
  }, [title, stopMarquee]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  const isAnimating = metrics !== null;

  return (
    <span
      ref={viewportRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      title={title}
      onPointerDown={() => {
        stopMarquee();
      }}
      onPointerEnter={() => {
        isHoveredRef.current = true;
        scheduleMarquee();
      }}
      onPointerLeave={() => {
        isHoveredRef.current = false;
        stopMarquee();
      }}
    >
      <span className={cn('block truncate', isAnimating ? 'opacity-0' : 'opacity-100')}>
        {title}
      </span>
      <span
        ref={movingTextRef}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 flex w-max items-center whitespace-nowrap',
          isAnimating ? 'opacity-100 transition-transform ease-linear' : 'opacity-0',
        )}
        style={{
          transform: `translateX(-${metrics?.distancePx ?? 0}px)`,
          transitionDuration: `${metrics?.durationMs ?? 0}ms`,
        }}
      >
        {title}
      </span>
    </span>
  );
};

export default OverflowingSessionTitle;
