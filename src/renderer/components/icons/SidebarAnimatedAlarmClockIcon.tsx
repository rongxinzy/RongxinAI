import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

const PRIMARY_VARIANTS: Variants = {
  normal: { x: 0, y: 0 },
  animate: { x: [0, -1, 1, 0], y: [0, -1.5, 0] },
};

const SECONDARY_VARIANTS: Variants = {
  normal: { x: 0, y: 0 },
  animate: { x: [0, -2, 2, 0], y: [0, -2.5, 0] },
};

const PRIMARY_TRANSITION = { duration: 0.36, ease: 'easeOut' } as const;

export interface SidebarAnimatedAlarmClockIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedAlarmClockIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export const SidebarAnimatedAlarmClockIcon = forwardRef<
  SidebarAnimatedAlarmClockIconHandle,
  SidebarAnimatedAlarmClockIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  const resetToNormal = useCallback(() => {
    controls.stop();
    void controls.start('normal');
  }, [controls]);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => void controls.start('animate'),
      stopAnimation: resetToNormal,
    };
  }, [controls, resetToNormal]);

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
      else resetToNormal();
    },
    [onMouseLeave, resetToNormal],
  );

  return (
    <div
      aria-hidden="true"
      className={cn('sidebar-animated-clock-icon size-4 shrink-0', className)}
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
        style={{ overflow: 'visible' }}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.circle
          animate={controls}
          cx="12"
          cy="13"
          initial="normal"
          r="8"
          transition={PRIMARY_TRANSITION}
          variants={PRIMARY_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M5 3 2 6"
          initial="normal"
          transition={PRIMARY_TRANSITION}
          variants={SECONDARY_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="m22 6-3-3"
          initial="normal"
          transition={PRIMARY_TRANSITION}
          variants={SECONDARY_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M6.38 18.7 4 21"
          initial="normal"
          transition={PRIMARY_TRANSITION}
          variants={PRIMARY_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M17.64 18.67 20 21"
          initial="normal"
          transition={PRIMARY_TRANSITION}
          variants={PRIMARY_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="m9 13 2 2 4-4"
          initial="normal"
          transition={PRIMARY_TRANSITION}
          variants={PRIMARY_VARIANTS}
        />
      </motion.svg>
    </div>
  );
});

SidebarAnimatedAlarmClockIcon.displayName = 'SidebarAnimatedAlarmClockIcon';
