import { recipe } from './recipe';

/** Native controls keep their DOM and handlers while sharing package-owned state styles. */
export function classicNativeControls(dark: boolean) {
  const transition = {
    'transition-property': 'color, background-color, border-color, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  const rounded = { 'border-radius': 'var(--zy-style-radius-md)' };
  const focus = { 'outline-style': 'none', 'box-shadow': '0 0 0 2px var(--ring)' };
  const fieldRing = { 'box-shadow': '0 0 0 1px color-mix(in oklab, var(--ring) 40%, transparent)' };
  return {
    'native-slide': recipe({ base: { ...rounded, ...transition, 'outline-style': 'none' }, focus }),
    'native-slide-selected': recipe({
      base: { 'background-color': 'var(--accent)', color: 'var(--accent-foreground)' },
    }),
    'native-slide-idle': recipe({ hover: { 'background-color': 'var(--muted)' } }),
    'native-activity-button': recipe({
      base: {
        ...rounded,
        ...transition,
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'color-mix(in oklab, var(--muted) 40%, transparent)',
        'font-family': 'var(--zy-style-font-mono)',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
    }),
    'native-workspace-action': recipe({
      base: {
        ...rounded,
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'color-mix(in srgb, var(--zy-text-primary) 4%, transparent)' },
    }),
    'native-field': recipe({
      base: {
        ...transition,
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'background-color': 'var(--background)',
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--foreground)',
        'outline-style': 'none',
      },
      hover: fieldRing,
      focus: { ...fieldRing, 'border-color': 'var(--ring)' },
    }),
    'native-question-field': recipe({
      placeholder: { color: dark ? 'var(--zy-text-secondary)' : 'var(--muted-foreground)' },
    }),
    'native-rename-field': recipe({
      base: { 'font-weight': 'var(--zy-component-font-weight-medium)' },
    }),
    'native-audit-link': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-sm)',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
        'text-underline-offset': '4px',
      },
      hover: { color: 'var(--foreground)', 'text-decoration': 'underline' },
      focus,
    }),
    'native-audit-row': recipe({
      base: { ...rounded, ...transition },
      hover: { 'background-color': 'var(--muted)' },
      focus: {
        'outline-style': 'none',
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
      },
      pressed: { translate: '0 1px' },
    }),
    'native-sidebar-rail': recipe({
      base: {
        'transition-property': 'all',
        'transition-duration': '150ms',
        'transition-timing-function': 'linear',
      },
    }),
    'native-sidebar-rail-line': recipe({ hover: { 'background-color': 'var(--sidebar-border)' } }),
    'native-sidebar-offcanvas': recipe({ hover: { 'background-color': 'var(--sidebar)' } }),
  };
}
