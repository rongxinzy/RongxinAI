'use client';

import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { cn } from '@shared/lib/utils';

function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: 'default' | 'sm' | 'lg';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'theme-avatar group/avatar relative flex shrink-0 select-none after:absolute after:inset-0',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('theme-avatar-image aspect-square size-full object-cover', className)}
      {...props}
    />
  );
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('theme-avatar-fallback flex size-full items-center justify-center', className)}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
