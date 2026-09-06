import { recipe } from './recipe';
export function classicMisc(dark: boolean) {
  return {
    label: recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'label-disabled': recipe({ base: { opacity: '0.5' } }),
    'breadcrumb-list': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    'breadcrumb-link': recipe({
      base: { 'transition-property': 'color', 'transition-duration': '150ms' },
      hover: { color: 'var(--foreground)' },
    }),
    'breadcrumb-page': recipe({
      base: { 'font-weight': 'var(--zy-component-font-weight-normal)', color: 'var(--foreground)' },
    }),
    'breadcrumb-separator': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'breadcrumb-ellipsis': recipe({ base: { width: '1.25rem', height: '1.25rem' } }),
    'breadcrumb-ellipsis-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'scroll-viewport': recipe({
      base: {
        'border-radius': 'inherit',
        'transition-property': 'color, box-shadow',
        'transition-duration': '150ms',
        'outline-style': 'none',
      },
      focus: {
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
        'outline-style': 'solid',
        'outline-width': '1px',
      },
    }),
    'scroll-bar': recipe({
      base: {
        padding: '1px',
        'transition-property': 'color, background-color, border-color',
        'transition-duration': '150ms',
        'border-style': 'solid',
      },
    }),
    'scroll-horizontal': recipe({
      base: { height: '0.625rem', 'border-top-width': '1px', 'border-top-color': 'transparent' },
    }),
    'scroll-vertical': recipe({
      base: { width: '0.625rem', 'border-left-width': '1px', 'border-left-color': 'transparent' },
    }),
    'scroll-thumb': recipe({
      base: { 'border-radius': '9999px', 'background-color': 'var(--border)' },
    }),
    avatar: recipe({ base: { width: '2rem', height: '2rem', 'border-radius': '9999px' } }),
    'avatar-small': recipe({ base: { width: '1.5rem', height: '1.5rem' } }),
    'avatar-large': recipe({ base: { width: '2.5rem', height: '2.5rem' } }),
    'avatar-outline': recipe({
      base: {
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'avatar-image': recipe({ base: { 'border-radius': '9999px' } }),
    'avatar-fallback': recipe({
      base: {
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
        color: 'var(--muted-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'avatar-small-fallback': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'avatar-badge': recipe({
      base: {
        'border-radius': '9999px',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
        'box-shadow': '0 0 0 2px var(--background)',
      },
    }),
    'avatar-badge-sm': recipe({ base: { width: '0.5rem', height: '0.5rem' } }),
    'avatar-badge-default': recipe({ base: { width: '0.625rem', height: '0.625rem' } }),
    'avatar-badge-lg': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'avatar-badge-icon': recipe({ base: { width: '0.5rem', height: '0.5rem' } }),
    'avatar-group-ring': recipe({ base: { 'box-shadow': '0 0 0 2px var(--background)' } }),
    'avatar-count': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
        color: 'var(--muted-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
        'box-shadow': '0 0 0 2px var(--background)',
      },
    }),
    'avatar-count-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'avatar-count-lg': recipe({ base: { width: '2.5rem', height: '2.5rem' } }),
    'avatar-count-icon-lg': recipe({ base: { width: '1.25rem', height: '1.25rem' } }),
    'avatar-count-sm': recipe({ base: { width: '1.5rem', height: '1.5rem' } }),
    'avatar-count-icon-sm': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'avatar-outline-blend': recipe({ base: { 'mix-blend-mode': dark ? 'lighten' : 'darken' } }),
    'avatar-badge-blend': recipe({ base: { 'background-blend-mode': 'color' } }),
    spinner: recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'animation-name': 'component-motion',
        'animation-duration': '1s',
        'animation-timing-function': 'linear',
        'animation-iteration-count': 'infinite',
      },
      motionStart: { rotate: '0deg' },
      motionEnd: { rotate: '360deg' },
    }),
  };
}
