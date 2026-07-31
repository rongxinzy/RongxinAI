import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes, MouseEvent } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@shared/lib/utils';

export interface SettingsAnimatedKeyboardIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsAnimatedKeyboardIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const KEYBOARD_PATHS = [
  { id: 'key1', d: 'M10 8h.01' },
  { id: 'key2', d: 'M12 12h.01' },
  { id: 'key3', d: 'M14 8h.01' },
  { id: 'key4', d: 'M16 12h.01' },
  { id: 'key5', d: 'M18 8h.01' },
  { id: 'key6', d: 'M6 8h.01' },
  { id: 'key7', d: 'M7 16h10' },
  { id: 'key8', d: 'M8 12h.01' },
];

export const SettingsAnimatedKeyboardIcon = forwardRef<
  SettingsAnimatedKeyboardIconHandle,
  SettingsAnimatedKeyboardIconProps
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
      className={cn('settings-animated-keyboard-icon size-5 shrink-0', className)}
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
        <rect height="16" rx="2" width="20" x="2" y="4" />
        {KEYBOARD_PATHS.map((path, index) => (
            <motion.path
              animate={controls}
              custom={index}
              d={path.d}
              initial={{ opacity: 1 }}
              key={path.id}
              variants={{ normal: { opacity: 1 }, animate: { opacity: [1, 0.25, 1], transition: { duration: 0.38, delay: index * 0.02, ease: 'easeOut' } } }}
            />
          ))}
      </svg>
    </div>
  );
});

SettingsAnimatedKeyboardIcon.displayName = 'SettingsAnimatedKeyboardIcon';
