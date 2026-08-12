import { motion, useAnimation, useReducedMotion, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface LocalInferenceAnimatedWifiPenIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LocalInferenceAnimatedWifiPenIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PEN_VARIANTS: Variants = {
  normal: { rotate: 0, x: 0, y: 0 },
  animate: {
    rotate: [-0.3, 0.2, -0.4],
    x: [0, -0.5, 1, 0],
    y: [0, 1, -0.5, 0],
    transition: { duration: 0.5, repeat: 1, ease: 'easeInOut' },
  },
};

export const LocalInferenceAnimatedWifiPenIcon = forwardRef<
  LocalInferenceAnimatedWifiPenIconHandle,
  LocalInferenceAnimatedWifiPenIconProps
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
      className={cn('local-inference-animated-wifi-pen-icon size-4 shrink-0', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <motion.svg
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
        <path d="M2 8.82a15 15 0 0 1 20 0" />
        <motion.path
          animate={controls}
          d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"
          initial="normal"
          variants={PEN_VARIANTS}
        />
        <path d="M5 12.859a10 10 0 0 1 10.5-2.222" />
        <path d="M8.5 16.429a5 5 0 0 1 3-1.406" />
      </motion.svg>
    </div>
  );
});

LocalInferenceAnimatedWifiPenIcon.displayName = 'LocalInferenceAnimatedWifiPenIcon';
