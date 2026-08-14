import { motion, useAnimation, useReducedMotion, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface GalleryThumbnailsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GalleryThumbnailsIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PATH_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: (index: number) => ({
    opacity: [0, 1],
    transition: { delay: index * 0.15, duration: 0.2 },
  }),
};

export const GalleryThumbnailsIcon = forwardRef<
  GalleryThumbnailsIconHandle,
  GalleryThumbnailsIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const prefersReducedMotion = useReducedMotion();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => {
        if (!prefersReducedMotion) void controls.start('animate');
      },
      stopAnimation: () => void controls.start('normal'),
    };
  }, [controls, prefersReducedMotion]);

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) onMouseEnter?.(event);
      else if (!prefersReducedMotion) void controls.start('animate');
    },
    [controls, onMouseEnter, prefersReducedMotion],
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
      className={cn('gallery-thumbnails-icon size-4 shrink-0', className)}
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
        <rect height="14" rx="2" width="18" x="3" y="3" />
        {['M4 21h1', 'M9 21h1', 'M14 21h1', 'M19 21h1'].map((path, index) => (
          <motion.path
            animate={controls}
            custom={index + 1}
            d={path}
            key={path}
            variants={PATH_VARIANTS}
          />
        ))}
      </svg>
    </div>
  );
});

GalleryThumbnailsIcon.displayName = 'GalleryThumbnailsIcon';
