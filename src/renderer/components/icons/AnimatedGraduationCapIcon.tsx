import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface AnimatedGraduationCapIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedGraduationCapIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CAP_VARIANTS: Variants = {
  normal: { rotate: 0, y: 0 },
  animate: { rotate: [0, -3, 3, 0], y: [0, -2, 0] },
};

const TASSEL_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: { rotate: [0, 15, -10, 5, 0] },
};

export const AnimatedGraduationCapIcon = forwardRef<
  AnimatedGraduationCapIconHandle,
  AnimatedGraduationCapIconProps
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
      className={cn('animated-graduation-cap-icon size-4 shrink-0', className)}
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
        <motion.g
          animate={controls}
          initial="normal"
          style={{ transformOrigin: '12px 12px' }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          variants={CAP_VARIANTS}
        >
          <path d="M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
          <motion.path
            animate={controls}
            d="M22 10v6"
            initial="normal"
            style={{ transformBox: 'fill-box', transformOrigin: 'top center' }}
            transition={{ delay: 0.06, duration: 0.34, ease: 'easeOut' }}
            variants={TASSEL_VARIANTS}
          />
        </motion.g>
      </svg>
    </div>
  );
});

AnimatedGraduationCapIcon.displayName = 'AnimatedGraduationCapIcon';
