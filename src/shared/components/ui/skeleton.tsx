import { cn } from '@shared/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('theme-skeleton', className)}
      {...props}
    />
  );
}

export { Skeleton };
