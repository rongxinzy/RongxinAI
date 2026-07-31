import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SettingsAnimatedMessageCircleMoreIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsAnimatedMessageCircleMoreIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DOT_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: (custom: number) => ({
    opacity: [1, 0.2, 1],
    transition: {
      opacity: { duration: 0.4, delay: custom * 0.1, ease: 'easeOut' },
    },
  }),
};

export const SettingsAnimatedMessageCircleMoreIcon = forwardRef<
  SettingsAnimatedMessageCircleMoreIconHandle,
  SettingsAnimatedMessageCircleMoreIconProps
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
      className={cn('settings-animated-message-circle-more-icon size-5 shrink-0', className)}
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
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <motion.path animate={controls} custom={0} d="M8 12h.01" variants={DOT_VARIANTS} />
        <motion.path animate={controls} custom={1} d="M12 12h.01" variants={DOT_VARIANTS} />
        <motion.path animate={controls} custom={2} d="M16 12h.01" variants={DOT_VARIANTS} />
      </svg>
    </div>
  );
});

SettingsAnimatedMessageCircleMoreIcon.displayName = 'SettingsAnimatedMessageCircleMoreIcon';
