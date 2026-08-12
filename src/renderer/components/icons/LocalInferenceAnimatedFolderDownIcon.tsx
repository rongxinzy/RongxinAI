import { motion, useAnimation, useReducedMotion, type Transition, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface LocalInferenceAnimatedFolderDownIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LocalInferenceAnimatedFolderDownIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ARROW_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: [0, 2, 0] },
};

const ARROW_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

export const LocalInferenceAnimatedFolderDownIcon = forwardRef<
  LocalInferenceAnimatedFolderDownIconHandle,
  LocalInferenceAnimatedFolderDownIconProps
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
      className={cn('local-inference-animated-folder-down-icon size-4 shrink-0', className)}
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
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        <motion.g
          animate={controls}
          initial="normal"
          transition={ARROW_TRANSITION}
          variants={ARROW_VARIANTS}
        >
          <path d="M12 10v6" />
          <path d="m15 13-3 3-3-3" />
        </motion.g>
      </svg>
    </div>
  );
});

LocalInferenceAnimatedFolderDownIcon.displayName = 'LocalInferenceAnimatedFolderDownIcon';
