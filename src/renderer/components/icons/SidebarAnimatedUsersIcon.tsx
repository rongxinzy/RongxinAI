import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SidebarAnimatedUsersIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SidebarAnimatedUsersIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PATH_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: { x: [-3, 0] },
};

export const SidebarAnimatedUsersIcon = forwardRef<
  SidebarAnimatedUsersIconHandle,
  SidebarAnimatedUsersIconProps
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
      className={cn('sidebar-expert-icon animated-users-icon size-4 shrink-0', className)}
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
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <motion.path
          animate={controls}
          d="M22 21v-2a4 4 0 0 0-3-3.87"
          initial="normal"
          transition={{ duration: 0.35, ease: 'easeOut' }}
          variants={PATH_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M16 3.13a4 4 0 0 1 0 7.75"
          initial="normal"
          transition={{ duration: 0.35, ease: 'easeOut' }}
          variants={PATH_VARIANTS}
        />
      </svg>
    </div>
  );
});

SidebarAnimatedUsersIcon.displayName = 'SidebarAnimatedUsersIcon';
