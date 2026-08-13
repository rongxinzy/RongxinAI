import { motion, useAnimation, useReducedMotion, type Transition, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SidebarAnimatedCpuIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedCpuIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TRANSITION: Transition = {
  duration: 0.5,
  ease: 'easeInOut',
  repeat: 1,
};

const Y_VARIANTS: Variants = {
  normal: { scale: 1, rotate: 0, opacity: 1 },
  animate: { scaleY: [1, 1.5, 1], opacity: [1, 0.8, 1] },
};

const X_VARIANTS: Variants = {
  normal: { scale: 1, rotate: 0, opacity: 1 },
  animate: { scaleX: [1, 1.5, 1], opacity: [1, 0.8, 1] },
};

export const SidebarAnimatedCpuIcon = forwardRef<
  SidebarAnimatedCpuIconHandle,
  SidebarAnimatedCpuIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const prefersReducedMotion = useReducedMotion();
  const isControlledRef = useRef(false);

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
      className={cn('sidebar-local-inference-icon animated-cpu-icon size-4 shrink-0', className)}
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
        <rect height="16" rx="2" width="16" x="4" y="4" />
        <rect height="6" rx="1" width="6" x="9" y="9" />
        <motion.path animate={controls} d="M15 2v2" transition={TRANSITION} variants={Y_VARIANTS} />
        <motion.path
          animate={controls}
          d="M15 20v2"
          transition={TRANSITION}
          variants={Y_VARIANTS}
        />
        <motion.path animate={controls} d="M2 15h2" transition={TRANSITION} variants={X_VARIANTS} />
        <motion.path animate={controls} d="M2 9h2" transition={TRANSITION} variants={X_VARIANTS} />
        <motion.path
          animate={controls}
          d="M20 15h2"
          transition={TRANSITION}
          variants={X_VARIANTS}
        />
        <motion.path animate={controls} d="M20 9h2" transition={TRANSITION} variants={X_VARIANTS} />
        <motion.path animate={controls} d="M9 2v2" transition={TRANSITION} variants={Y_VARIANTS} />
        <motion.path animate={controls} d="M9 20v2" transition={TRANSITION} variants={Y_VARIANTS} />
      </svg>
    </div>
  );
});

SidebarAnimatedCpuIcon.displayName = 'SidebarAnimatedCpuIcon';
