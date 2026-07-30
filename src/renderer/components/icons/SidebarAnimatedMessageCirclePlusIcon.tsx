import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SidebarAnimatedMessageCirclePlusIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedMessageCirclePlusIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PLUS_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: { pathLength: [0, 1], opacity: [0, 1] },
};

export const SidebarAnimatedMessageCirclePlusIcon = forwardRef<
  SidebarAnimatedMessageCirclePlusIconHandle,
  SidebarAnimatedMessageCirclePlusIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
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
      className={cn('sidebar-animated-message-plus-icon size-4 shrink-0', className)}
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
        <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
        <motion.path
          animate={controls}
          d="M12 8v8"
          initial="normal"
          transition={{ duration: 0.15, ease: 'easeOut' }}
          variants={PLUS_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M8 12h8"
          initial="normal"
          transition={{ delay: 0.1, duration: 0.15, ease: 'easeOut' }}
          variants={PLUS_VARIANTS}
        />
      </svg>
    </div>
  );
});

SidebarAnimatedMessageCirclePlusIcon.displayName = 'SidebarAnimatedMessageCirclePlusIcon';
