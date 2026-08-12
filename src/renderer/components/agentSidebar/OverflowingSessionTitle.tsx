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

const OverflowingSessionTitle: React.FC<SessionTitleMarqueeProps> = ({ title }) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const movingTextRef = useRef<HTMLSpanElement>(null);
  const isHoveredRef = useRef(false);
  const [metrics, setMetrics] = useState<SessionTitleMarqueeMetrics | null>(null);

  const stopMarquee = useCallback(() => {
    setMetrics(null);
  }, []);

  const startMarquee = useCallback(() => {
    const viewport = viewportRef.current;
    const movingText = movingTextRef.current;
    if (!viewport || !movingText || prefersReducedMotion()) {
      setMetrics(null);
      return;
    }

    setMetrics(
      getSessionTitleMarqueeMetrics(
        viewport.getBoundingClientRect().width,
        movingText.getBoundingClientRect().width,
      ),
    );
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      if (isHoveredRef.current) startMarquee();
    });
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [startMarquee]);

  useEffect(() => {
    setMetrics(null);
  }, [title]);

  const isAnimating = metrics !== null;

  return (
    <span
      ref={viewportRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      title={title}
      onPointerEnter={() => {
        isHoveredRef.current = true;
        startMarquee();
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
