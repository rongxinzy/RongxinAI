import { Slot } from '@radix-ui/react-slot';
import { cn } from '@shared/lib/utils';
import * as React from 'react';

import { button21stVariants, type ButtonVariantProps } from './button-21st-variants';

export interface Button21stProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  asChild?: boolean;
  isDisabled?: boolean;
}

const Button21st = React.forwardRef<HTMLButtonElement, Button21stProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'default',
      asChild = false,
      isDisabled,
      onClick,
      type,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        {...props}
        type={asChild ? undefined : type || 'button'}
        disabled={isDisabled || disabled}
        onClick={onClick}
        className={cn(button21stVariants({ variant, size }), className)}
      />
    );
  },
);
Button21st.displayName = 'Button21st';

export { Button21st };
