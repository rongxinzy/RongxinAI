import { motion, useAnimation, type Transition, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface AnimatedDeleteIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedDeleteIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LID_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: -1.1 },
};

const SPRING_TRANSITION: Transition = { duration: 0.2, ease: 'easeOut' };

export const AnimatedDeleteIcon = forwardRef<AnimatedDeleteIconHandle, AnimatedDeleteIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 14, ...props }, ref) => {
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
        className={cn('animated-delete-icon size-3.5 shrink-0', className)}
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
          <motion.g animate={controls} transition={SPRING_TRANSITION} variants={LID_VARIANTS}>
            <path d="M3 6h18" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </motion.g>
          <path d="M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </div>
    );
  },
);

AnimatedDeleteIcon.displayName = 'AnimatedDeleteIcon';
