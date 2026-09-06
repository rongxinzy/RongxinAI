import { recipe } from './recipe';
export function classicFields(dark: boolean) {
  return {
    'field-legend': recipe({ base: { 'font-weight': 'var(--zy-component-font-weight-medium)' } }),
    'field-legend-label': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'field-legend-heading': recipe({ base: { 'font-size': 'var(--zy-component-text-base)' } }),
    field: recipe({ base: {}, invalid: { color: 'var(--destructive)' } }),
    'field-content': recipe({ base: { 'line-height': '1.375' } }),
    'field-label': recipe({ base: { 'line-height': '1.375' } }),
    'field-label-disabled': recipe({ base: { opacity: '0.5' } }),
    'field-label-card': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
      },
    }),
    'field-label-inset': recipe({ base: { padding: '0.625rem' } }),
    'field-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'field-description': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.5',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'field-link': recipe({
      base: { 'text-decoration': 'underline', 'text-underline-offset': '4px' },
      hover: { color: 'var(--primary)' },
    }),
    'field-separator': recipe({
      base: { height: '1.25rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'field-separator-content': recipe({
      base: {
        'background-color': 'var(--background)',
        'padding-inline': '0.5rem',
        color: 'var(--muted-foreground)',
      },
    }),
    'field-error': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--destructive)',
      },
    }),
    toast: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'var(--border)',
        'box-shadow': 'var(--zy-style-shadow-xl)',
        'animation-name': 'component-motion',
        'animation-duration': '0.2s',
        'animation-timing-function': 'ease-out',
      },
      motionStart: { opacity: '0', translate: '0 -8px' },
      motionEnd: { opacity: '1', translate: '0 0' },
    }),
    'toast-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'field-label-checked': recipe({
      base: {
        'border-color': `color-mix(in oklab, var(--primary) ${dark ? 20 : 30}%, transparent)`,
        'background-color': `color-mix(in oklab, var(--primary) ${dark ? 10 : 5}%, transparent)`,
      },
    }),
    'control-caption': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'control-caption-muted': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
    'control-label-strong': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
  };
}
