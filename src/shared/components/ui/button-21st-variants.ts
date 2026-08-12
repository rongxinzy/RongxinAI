import { cva, type VariantProps } from 'class-variance-authority';

const button21stSurfaceClassName = [
  'bg-background shadow-none',
  'hover:shadow-lg hover:shadow-foreground/10',
  'active:shadow-inset',
].join(' ');

const button21stVariants = cva(
  [
    'group/button-21st relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border text-sm leading-tight font-medium whitespace-nowrap outline-none select-none',
    'transition-[background-color,border-color,box-shadow,filter] duration-200 ease-out',
    'focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          button21stSurfaceClassName,
          'border-border fill-current text-foreground hover:border-border',
        ].join(' '),
        secondary: [
          button21stSurfaceClassName,
          'border-border fill-current text-secondary-foreground hover:border-border',
        ].join(' '),
        danger: [
          button21stSurfaceClassName,
          'border-border fill-current text-destructive hover:border-border',
        ].join(' '),
        loading: [
          button21stSurfaceClassName,
          'border-border bg-primary-muted fill-current text-primary disabled:opacity-100',
          'hover:border-border',
        ].join(' '),
        closing: [
          button21stSurfaceClassName,
          'border-border bg-destructive/10 fill-current text-destructive disabled:opacity-100',
          'hover:border-border',
        ].join(' '),
      },
      size: {
        default: 'h-10 gap-1.5 px-5',
        sm: 'h-9 gap-1.5 px-4 text-[0.8rem]',
        lg: 'h-12 gap-2 px-7',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

type ButtonVariantProps = VariantProps<typeof button21stVariants>;

export { button21stVariants, type ButtonVariantProps };
