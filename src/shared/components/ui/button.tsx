import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cn } from '@shared/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'theme-button group/button inline-flex shrink-0 items-center justify-center bg-clip-padding whitespace-nowrap select-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',

  {
    variants: {
      variant: {
        default: 'theme-button-default',
        outline: 'theme-button-outline',
        secondary: 'theme-button-secondary',
        ghost: 'theme-button-ghost',
        'prompt-selector': 'theme-button-prompt-selector',
        navigation: 'theme-button-navigation justify-start text-left',
        toolbar: 'theme-button-toolbar',
        destructive: 'theme-button-destructive',
        link: 'theme-button-link',
        appearance: 'theme-button-appearance',
      },
      size: {
        default: 'theme-button-size-default',
        xs: 'theme-button-size-xs',
        sm: 'theme-button-size-sm',
        lg: 'theme-button-size-lg',
        appearance: 'theme-button-size-appearance w-full flex-col',
        navigation: 'theme-button-size-navigation w-full',
        icon: 'theme-button-size-icon ',
        'icon-xs': 'theme-button-size-icon-xs',
        'icon-sm': 'theme-button-size-icon-sm',
        'icon-lg': 'theme-button-size-icon-lg ',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
