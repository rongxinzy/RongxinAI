import { recipe } from './recipe';
export function classicTabs(dark: boolean) {
  const clear = { 'background-color': 'transparent', 'box-shadow': 'none' };
  const transition = {
    'transition-property': 'all',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  return {
    'tabs-list': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '3px',
        color: 'var(--muted-foreground)',
      },
    }),
    'tabs-list-horizontal': recipe({ base: { height: '2rem' } }),
    'tabs-list-default': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'tabs-list-line': recipe({
      base: { 'border-radius': '0px', 'background-color': 'transparent' },
    }),
    'tabs-trigger': recipe({
      base: {
        height: 'calc(100% - 1px)',
        ...transition,
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'padding-inline': '0.375rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: dark
          ? 'var(--muted-foreground)'
          : 'color-mix(in oklab, var(--foreground) 60%, transparent)',
      },
      hover: { color: 'var(--foreground)' },
      focus: {
        'border-color': 'var(--ring)',
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
        'outline-width': '1px',
        'outline-style': 'solid',
        'outline-color': 'var(--ring)',
      },
      selected: {
        'background-color': dark
          ? 'color-mix(in oklab, var(--input) 30%, transparent)'
          : 'var(--background)',
        color: 'var(--foreground)',
        ...(dark ? { 'border-color': 'var(--input)' } : {}),
      },
      disabled: { opacity: '0.5' },
    }),
    'tabs-default-trigger': recipe({ selected: { 'box-shadow': 'var(--zy-style-shadow-sm)' } }),
    'tabs-line-trigger': recipe({
      base: { 'background-color': 'transparent' },
      selected: { ...clear, ...(dark ? { 'border-color': 'transparent' } : {}) },
    }),
    'tabs-trigger-leading': recipe({ base: { 'padding-left': '0.25rem' } }),
    'tabs-trigger-trailing': recipe({ base: { 'padding-right': '0.25rem' } }),
    'tabs-trigger-icon': recipe({ base: { height: '1rem', width: '1rem' } }),
    'tabs-trigger-indicator': recipe({
      base: {
        'background-color': 'var(--foreground)',
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    }),
    'tabs-line-indicator': recipe({ selected: { opacity: '1' } }),
    'tabs-horizontal-indicator': recipe({ base: { height: '0.125rem' } }),
    'tabs-vertical-indicator': recipe({ base: { width: '0.125rem' } }),
    'tabs-content': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', 'outline-style': 'none' },
    }),
    // Preserve measured list height: the original horizontal rule won over h-9.
    'page-tabs-list': recipe({ base: { height: '2rem', padding: '0px' } }),
    'page-tabs-trigger': recipe({
      base: {
        ...clear,
        height: '2.25rem',
        'border-radius': '0px',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { color: 'var(--foreground)' },
      selected: { ...clear, color: 'var(--foreground)' },
    }),
    'page-tabs-indicator': recipe({
      base: {
        height: '0.125rem',
        'border-radius': '9999px',
        'background-color': 'var(--foreground)',
      },
    }),
  };
}
