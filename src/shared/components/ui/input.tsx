import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '@shared/lib/utils';
import * as React from 'react';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'theme-input w-full min-w-0 file:inline-flex disabled:pointer-events-none disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
