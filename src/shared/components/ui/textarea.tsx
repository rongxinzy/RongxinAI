import { cn } from '@shared/lib/utils';
import * as React from 'react';

function Textarea({
  className,
  autoGrow = true,
  ...props
}: React.ComponentProps<'textarea'> & {
  /** Use false with native rows in forms that must keep their actions in view. */
  autoGrow?: boolean;
}) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'theme-textarea flex w-full disabled:cursor-not-allowed',
        autoGrow ? 'field-sizing-content' : 'resize-none overflow-y-auto',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
