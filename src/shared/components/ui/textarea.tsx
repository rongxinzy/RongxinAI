import { cn } from '@shared/lib/utils';
import * as React from 'react';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-(--zy-surface) px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground hover:border-ring/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/40 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
