import type { CSSProperties, HTMLAttributes } from 'react';
import { forwardRef } from 'react';

import styles from './BreathingDot.module.css';

interface BreathingDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  color?: string;
  size?: number;
  duration?: number;
  active?: boolean;
  label?: string;
}

type DotStyle = CSSProperties & {
  '--dot-color': string;
  '--dot-size': string;
  '--dot-duration': string;
};

export const BreathingDot = forwardRef<HTMLSpanElement, BreathingDotProps>(
  function BreathingDot(
    {
      color = 'var(--zy-success)',
      size = 10,
      duration = 2,
      active = true,
      label,
      className,
      style,
      ...props
    },
    ref,
  ) {
    const dotStyle: DotStyle = {
      ...style,
      '--dot-color': color,
      '--dot-size': `${size}px`,
      '--dot-duration': `${duration}s`,
    };

    return (
      <span
        ref={ref}
        {...props}
        className={`${styles.dot}${className ? ` ${className}` : ''}`}
        data-active={active}
        style={dotStyle}
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    );
  },
);

BreathingDot.displayName = 'BreathingDot';
