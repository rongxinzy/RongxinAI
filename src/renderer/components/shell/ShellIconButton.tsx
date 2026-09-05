import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import type { ComponentProps } from 'react';

type ShellIconButtonProps = Omit<
  ComponentProps<typeof Button>,
  'variant' | 'size' | 'aria-label'
> & {
  label: string;
};

export function ShellIconButton({ label, className, ...props }: ShellIconButtonProps) {
  return (
    <Button
      type="button"
      {...props}
      variant="toolbar"
      size="icon"
      aria-label={label}
      title={label}
      className={cn('non-draggable', className)}
    />
  );
}
