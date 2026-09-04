import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

const TerminalIconAnimationState = {
  Normal: 'normal',
  Animate: 'animate',
} as const;

type TerminalIconAnimationState =
  (typeof TerminalIconAnimationState)[keyof typeof TerminalIconAnimationState];

const LINE_VARIANTS: Variants = {
  [TerminalIconAnimationState.Normal]: { opacity: 1 },
  [TerminalIconAnimationState.Animate]: {
    opacity: [1, 0, 1],
    transition: {
      duration: 0.35,
      ease: 'linear',
    },
  },
};

export interface SidebarAnimatedTerminalIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedTerminalIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export const SidebarAnimatedTerminalIcon = forwardRef<
  SidebarAnimatedTerminalIconHandle,
  SidebarAnimatedTerminalIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  const stopAnimation = useCallback(() => {
    controls.stop();
    void controls.start(TerminalIconAnimationState.Normal);
  }, [controls]);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => void controls.start(TerminalIconAnimationState.Animate),
      stopAnimation,
    };
  }, [controls, stopAnimation]);

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseEnter?.(event);
      else void controls.start(TerminalIconAnimationState.Animate);
    },
    [controls, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseLeave?.(event);
      else stopAnimation();
    },
    [onMouseLeave, stopAnimation],
  );

  return (
    <div
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <polyline points="4 17 10 11 4 5" />
        <motion.line
          animate={controls}
          initial={TerminalIconAnimationState.Normal}
          variants={LINE_VARIANTS}
          x1="12"
          x2="20"
          y1="19"
          y2="19"
        />
      </svg>
    </div>
  );
});

SidebarAnimatedTerminalIcon.displayName = 'SidebarAnimatedTerminalIcon';
