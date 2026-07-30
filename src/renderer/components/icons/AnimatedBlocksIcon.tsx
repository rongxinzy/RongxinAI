import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface AnimatedBlocksIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedBlocksIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const BLOCK_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: { translateX: -4, translateY: 4 },
};

export const AnimatedBlocksIcon = forwardRef<AnimatedBlocksIconHandle, AnimatedBlocksIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
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
        className={cn('animated-blocks-icon size-4 shrink-0', className)}
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
          <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
          <motion.path
            animate={controls}
            d="M14 3h7v7h-7z"
            initial="normal"
            transition={{ duration: 0.32, ease: 'easeOut' }}
            variants={BLOCK_VARIANTS}
          />
        </svg>
      </div>
    );
  },
);

AnimatedBlocksIcon.displayName = 'AnimatedBlocksIcon';
