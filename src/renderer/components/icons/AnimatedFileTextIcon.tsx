import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface AnimatedFileTextIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedFileTextIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LINE_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: { pathLength: [1, 0, 1], opacity: [1, 0.45, 1] },
};

export const AnimatedFileTextIcon = forwardRef<
  AnimatedFileTextIconHandle,
  AnimatedFileTextIconProps
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
      className={cn('animated-file-text-icon size-4 shrink-0', className)}
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
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <motion.path
          animate={controls}
          d="M10 9H8"
          initial="normal"
          transition={{ duration: 0.24, ease: 'easeOut' }}
          variants={LINE_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M16 13H8"
          initial="normal"
          transition={{ delay: 0.08, duration: 0.24, ease: 'easeOut' }}
          variants={LINE_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M16 17H8"
          initial="normal"
          transition={{ delay: 0.16, duration: 0.24, ease: 'easeOut' }}
          variants={LINE_VARIANTS}
        />
      </svg>
    </div>
  );
});

AnimatedFileTextIcon.displayName = 'AnimatedFileTextIcon';
