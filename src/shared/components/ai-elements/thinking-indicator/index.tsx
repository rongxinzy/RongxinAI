import { cn } from '@shared/lib/utils';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import { readIndicatorPaint, subscribeIndicatorAppearance } from './appearance';
import type { ThinkingIndicatorPaint } from './appearance';
import { THINKING_ORB_PRESETS, ThinkingIndicatorVariant } from './constants';

interface ThinkingIndicatorProps {
  variant?: ThinkingIndicatorVariant;
  paused?: boolean;
  className?: string;
}

/** Bridges theme-owned CSS appearance to the canvas dependency's explicit ink. */
export const ThinkingIndicator = memo(function ThinkingIndicator({
  variant = ThinkingIndicatorVariant.Inline,
  paused = false,
  className,
}: ThinkingIndicatorProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [paint, setPaint] = useState<ThinkingIndicatorPaint | null>(null);

  useLayoutEffect(() => {
    const updatePaint = () => {
      if (!hostRef.current) return;
      const next = readIndicatorPaint(hostRef.current);
      setPaint(previous =>
        previous?.color === next?.color && previous?.theme === next?.theme ? previous : next,
      );
    };
    const unsubscribe = subscribeIndicatorAppearance(updatePaint);
    updatePaint();
    return unsubscribe;
  }, [variant]);

  return (
    <span
      ref={hostRef}
      className={cn('theme-thinking-indicator inline-flex shrink-0', className)}
      data-variant={variant}
      aria-hidden="true"
    >
      {paint ? (
        <ThinkingOrb
          state="working"
          size={THINKING_ORB_PRESETS[variant]}
          color={paint.color}
          theme={paint.theme}
          paused={paused}
          style={{ width: '100%', height: '100%' }}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
});
