import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface AnimatedLaptopMinimalCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedLaptopMinimalCheckIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CHECK_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: { pathLength: [0, 1], opacity: [0, 1] },
};

export const AnimatedLaptopMinimalCheckIcon = forwardRef<
  AnimatedLaptopMinimalCheckIconHandle,
  AnimatedLaptopMinimalCheckIconProps
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
      className={cn('animated-laptop-minimal-check-icon size-4 shrink-0', className)}
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
        <path d="M2 20h20" />
        <rect height="12" rx="2" width="18" x="3" y="4" />
        <motion.path
          animate={controls}
          d="m9 10 2 2 4-4"
          initial="normal"
          style={{ transformOrigin: 'center' }}
          transition={{ duration: 0.38, ease: 'easeOut' }}
          variants={CHECK_VARIANTS}
        />
      </svg>
    </div>
  );
});

AnimatedLaptopMinimalCheckIcon.displayName = 'AnimatedLaptopMinimalCheckIcon';
