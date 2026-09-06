import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cn } from '@shared/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const toggleVariants = cva(
  'theme-toggle group/toggle inline-flex items-center justify-center gap-1 whitespace-nowrap disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: { default: '', outline: 'theme-toggle-outline' },
      size: { default: 'theme-toggle-default', sm: 'theme-toggle-small', lg: 'theme-toggle-large' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
