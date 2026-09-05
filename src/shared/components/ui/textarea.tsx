import { cn } from '@shared/lib/utils';
import * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'theme-textarea flex field-sizing-content w-full disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
