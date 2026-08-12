import { motion, useAnimation, type Variants } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SettingsAnimatedSunMediumIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsAnimatedSunMediumIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PATH_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: (index: number) => ({
    opacity: [0, 1],
    transition: { delay: index * 0.035, duration: 0.32, ease: 'easeOut' },
  }),
};

const SUN_RAYS = [
  'M12 3v1',
  'M12 20v1',
  'M3 12h1',
  'M20 12h1',
  'm18.364 5.636-.707.707',
  'm6.343 17.657-.707.707',
  'm5.636 5.636.707.707',
  'm17.657 17.657.707.707',
];

export const SettingsAnimatedSunMediumIcon = forwardRef<
  SettingsAnimatedSunMediumIconHandle,
  SettingsAnimatedSunMediumIconProps
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
      className={cn('settings-animated-sun-medium-icon size-5 shrink-0', className)}
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
        <circle cx="12" cy="12" r="4" />
        {SUN_RAYS.map((path, index) => (
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

SettingsAnimatedSunMediumIcon.displayName = 'SettingsAnimatedSunMediumIcon';
