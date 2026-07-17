import { cva, type VariantProps } from 'class-variance-authority';

const button21stSurfaceClassName = [
  'bg-[linear-gradient(180deg,#f7f7f7_0%,#ffffff_100%)]',
  'shadow-[0_1px_2px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.55)]',
  "after:absolute after:inset-0 after:rounded-[inherit] after:border-[1.5px] after:border-white/50 after:content-[''] after:pointer-events-none",
  'after:[-webkit-mask-image:linear-gradient(to_top,transparent_0,black_100%)] after:[mask-image:linear-gradient(to_top,transparent_0,black_100%)]',
  'after:shadow-[inset_0_1px_2px_rgba(24,24,24,0.045)] after:transition-opacity',
  'hover:bg-[linear-gradient(180deg,#eeeeee_0%,#ffffff_100%)] hover:shadow-[0_2px_5px_rgba(15,23,42,0.075),inset_0_1px_0_rgba(255,255,255,0.35)] hover:after:opacity-0',
  'active:brightness-[0.995] active:shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]',
].join(' ');

const button21stVariants = cva(
  [
    'group/button-21st relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-3xl border text-sm font-semibold whitespace-nowrap outline-none select-none',
    'transition-[background-color,border-color,box-shadow,filter] duration-200 ease-out',
    'focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          button21stSurfaceClassName,
          'border-border/70 fill-current text-foreground hover:border-[color:color-mix(in_srgb,var(--lobster-foreground)_18%,var(--lobster-border)_82%)]',
        ].join(' '),
        secondary: [
          button21stSurfaceClassName,
          'border-border/80 fill-current text-secondary-foreground hover:border-[color:color-mix(in_srgb,var(--lobster-foreground)_14%,var(--lobster-border)_86%)]',
          'hover:bg-[linear-gradient(180deg,#f6f6f6_0%,#ffffff_100%)]',
        ].join(' '),
        danger: [
          button21stSurfaceClassName,
          'border-border/70 fill-current text-[var(--lobster-destructive)] hover:border-[color:color-mix(in_srgb,var(--lobster-foreground)_18%,var(--lobster-border)_82%)]',
        ].join(' '),
        loading: [
          'bg-[linear-gradient(180deg,var(--lobster-primary)_0%,var(--lobster-primary-hover)_100%)]',
          'border-[var(--lobster-primary)] fill-current text-[var(--lobster-primary-foreground)]',
          'shadow-[0_1px_2px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.24)]',
          "after:absolute after:inset-0 after:rounded-[inherit] after:border-[1.5px] after:border-white/35 after:content-[''] after:pointer-events-none",
          'after:[-webkit-mask-image:linear-gradient(to_top,transparent_0,black_100%)] after:[mask-image:linear-gradient(to_top,transparent_0,black_100%)]',
          'after:shadow-[inset_0_1px_2px_rgba(24,24,24,0.08)] after:transition-opacity',
          'hover:bg-[linear-gradient(180deg,var(--lobster-primary-hover)_0%,var(--lobster-primary)_100%)] hover:after:opacity-0',
          'active:brightness-[0.98]',
        ].join(' '),
        closing: [
          'bg-[linear-gradient(180deg,var(--lobster-destructive)_0%,color-mix(in_srgb,var(--lobster-destructive)_88%,black)_100%)]',
          'border-[var(--lobster-destructive)] fill-current text-[var(--lobster-destructive-foreground)]',
          'shadow-[0_1px_2px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.24)]',
          "after:absolute after:inset-0 after:rounded-[inherit] after:border-[1.5px] after:border-white/35 after:content-[''] after:pointer-events-none",
          'after:[-webkit-mask-image:linear-gradient(to_top,transparent_0,black_100%)] after:[mask-image:linear-gradient(to_top,transparent_0,black_100%)]',
          'after:shadow-[inset_0_1px_2px_rgba(24,24,24,0.08)] after:transition-opacity',
          'hover:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--lobster-destructive)_92%,white)_0%,var(--lobster-destructive)_100%)] hover:after:opacity-0',
          'active:brightness-[0.98]',
        ].join(' '),
      },
      size: {
        default: 'h-10 gap-1.5 px-5',
        sm: 'h-9 gap-1.5 px-4 text-xs',
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
