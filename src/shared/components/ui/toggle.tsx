import { cva } from 'class-variance-authority';

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

export { toggleVariants };
