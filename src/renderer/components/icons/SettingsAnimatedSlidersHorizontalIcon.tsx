import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SettingsAnimatedSlidersHorizontalIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsAnimatedSlidersHorizontalIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TRANSITION = { duration: 0.4, ease: 'easeOut' } as const;

export const SettingsAnimatedSlidersHorizontalIcon = forwardRef<
  SettingsAnimatedSlidersHorizontalIconHandle,
  SettingsAnimatedSlidersHorizontalIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 20, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => void controls.start('animate'),
      stopAnimation: () => void controls.start('normal'),
    };
  });

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseEnter?.(event);
      else void controls.start('animate');
    },
    [controls, onMouseEnter],
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
      className={cn('settings-animated-sliders-horizontal-icon size-5 shrink-0', className)}
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
        <motion.g animate={controls} transition={TRANSITION} variants={{ normal: { x: 0 }, animate: { x: -1 } }}>
          <path d="M21 4H3" />
          <path d="M21 12H3" />
          <path d="M21 20H3" />
        </motion.g>
        <motion.g animate={controls} transition={TRANSITION} variants={{ normal: { x: 0 }, animate: { x: -2 } }}>
          <path d="M14 2v4" />
        </motion.g>
        <motion.g animate={controls} transition={TRANSITION} variants={{ normal: { x: 0 }, animate: { x: 2 } }}>
          <path d="M8 10v4" />
        </motion.g>
        <motion.g animate={controls} transition={TRANSITION} variants={{ normal: { x: 0 }, animate: { x: -2 } }}>
          <path d="M16 18v4" />
        </motion.g>
      </svg>
    </div>
  );
});

SettingsAnimatedSlidersHorizontalIcon.displayName = 'SettingsAnimatedSlidersHorizontalIcon';
