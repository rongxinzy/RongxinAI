import { motion, useAnimation, useReducedMotion, type Transition, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SidebarAnimatedPanelLeftCloseIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedPanelLeftCloseIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DEFAULT_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

const PATH_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: { x: [0, -1.5, 0] },
};

export const SidebarAnimatedPanelLeftCloseIcon = forwardRef<
  SidebarAnimatedPanelLeftCloseIconHandle,
  SidebarAnimatedPanelLeftCloseIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => {
        if (!prefersReducedMotion) void controls.start('animate');
      },
      stopAnimation: () => void controls.start('normal'),
    };
  }, [controls, prefersReducedMotion]);

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseEnter?.(event);
      else if (!prefersReducedMotion) void controls.start('animate');
    },
    [controls, onMouseEnter, prefersReducedMotion],
  );

  const handleMouseLeave = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseLeave?.(event);
      else void controls.start('normal');
    },
    [controls, onMouseLeave],
  );

  return (
    <div
      aria-hidden="true"
      className={cn('sidebar-animated-panel-left-close-icon size-4 shrink-0', className)}
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
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <path d="M9 3v18" />
        <motion.path
          animate={controls}
          d="m16 15-3-3 3-3"
          transition={DEFAULT_TRANSITION}
          variants={PATH_VARIANTS}
        />
      </svg>
    </div>
  );
});

SidebarAnimatedPanelLeftCloseIcon.displayName = 'SidebarAnimatedPanelLeftCloseIcon';
