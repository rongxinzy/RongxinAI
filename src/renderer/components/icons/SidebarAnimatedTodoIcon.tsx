import { motion, useAnimation, useReducedMotion, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SidebarAnimatedTodoIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedTodoIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const VARIANTS: Variants = {
  normal: { y: 0, rotate: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  animate: {
    y: [0, -2, 0],
    rotate: [0, -3, 0],
    transition: { duration: 0.55, ease: 'easeInOut', times: [0, 0.45, 1] },
  },
};

export const SidebarAnimatedTodoIcon = forwardRef<
  SidebarAnimatedTodoIconHandle,
  SidebarAnimatedTodoIconProps
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
      className={cn('sidebar-animated-todo-icon size-4 shrink-0', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <motion.svg
        animate={controls}
        fill="none"
        height={size}
        initial="normal"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        style={{ transformOrigin: '12px 12px' }}
        variants={VARIANTS}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M9 6h11" />
        <path d="M9 12h11" />
        <path d="M9 18h11" />
        <path d="m3 6 1 1 2-2" />
        <path d="m3 12 1 1 2-2" />
        <path d="m3 18 1 1 2-2" />
      </motion.svg>
    </div>
  );
});

SidebarAnimatedTodoIcon.displayName = 'SidebarAnimatedTodoIcon';
