import { recipe } from './recipe';

export function classicChoiceControls(dark: boolean) {
  const focus = {
    'border-color': 'var(--ring)',
    'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
  };
  const invalid = {
    'border-color': dark
      ? 'color-mix(in oklab, var(--destructive) 50%, transparent)'
      : 'var(--destructive)',
    'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) ${dark ? 40 : 20}%, transparent)`,
  };
  return {
    radio: recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'outline-style': 'none',
        'background-color': dark
          ? 'color-mix(in oklab, var(--input) 30%, transparent)'
          : 'transparent',
      },
      focus,
      invalid,
      disabled: { opacity: '0.5' },
      checked: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
      },
    }),
    'radio-checked-invalid': recipe({ invalid: { 'border-color': 'var(--primary)' } }),
    'radio-indicator': recipe({ base: { width: '1rem', height: '1rem' } }),
    'radio-dot': recipe({
      base: {
        width: '0.5rem',
        height: '0.5rem',
        'border-radius': '9999px',
        'background-color': 'var(--primary-foreground)',
      },
    }),
    toggle: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'background-color': 'transparent',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
      selected: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
      focus,
      invalid: {
        'border-color': 'var(--destructive)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) ${dark ? 40 : 20}%, transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'toggle-on': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'toggle-outline': recipe({
      base: { 'border-width': '1px', 'border-style': 'solid', 'border-color': 'var(--input)' },
    }),
    'toggle-default': recipe({
      base: { height: '2rem', 'min-width': '2rem', 'padding-inline': '0.625rem' },
    }),
    'toggle-small': recipe({
      base: {
        height: '1.75rem',
        'min-width': '1.75rem',
        'padding-inline': '0.625rem',
        'border-radius': 'var(--zy-style-radius-md)',
      },
    }),
    'toggle-large': recipe({
      base: { height: '2.25rem', 'min-width': '2.25rem', 'padding-inline': '0.625rem' },
    }),
    'toggle-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'toggle-small-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'toggle-leading': recipe({ base: { 'padding-left': '0.5rem' } }),
    'toggle-trailing': recipe({ base: { 'padding-right': '0.5rem' } }),
    'toggle-small-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'toggle-small-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'toggle-group': recipe({ base: { 'border-radius': 'var(--zy-style-radius-lg)' } }),
    'toggle-group-small': recipe({ base: { 'border-radius': 'var(--zy-style-radius-md)' } }),
    'toggle-joined': recipe({ base: { 'border-radius': '0px', 'padding-inline': '0.5rem' } }),
    'toggle-joined-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'toggle-joined-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'toggle-joined-horizontal-outline': recipe({ base: { 'border-left-width': '0px' } }),
    'toggle-joined-horizontal-first-outline': recipe({ base: { 'border-left-width': '1px' } }),
    'toggle-joined-horizontal-first': recipe({
      base: {
        'border-top-left-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-left-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-horizontal-last': recipe({
      base: {
        'border-top-right-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-vertical-outline': recipe({ base: { 'border-top-width': '0px' } }),
    'toggle-joined-vertical-first-outline': recipe({ base: { 'border-top-width': '1px' } }),
    'toggle-joined-vertical-first': recipe({
      base: {
        'border-top-left-radius': 'var(--zy-style-radius-lg)',
        'border-top-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-vertical-last': recipe({
      base: {
        'border-bottom-left-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
  };
}
