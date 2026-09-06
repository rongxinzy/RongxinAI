import { recipe } from './recipe';

export function classicSupplementaryControls(dark: boolean) {
  const focus = {
    'border-color': 'var(--ring)',
    'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
  };
  const transition = {
    'transition-property': 'color, background-color, border-color, opacity, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'ease-out',
  };
  return {
    switch: recipe({
      base: {
        'background-color': 'var(--zy-surface-raised)',
        'box-shadow': 'var(--zy-style-shadow-inset)',
        'transition-property': 'background-color, box-shadow',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'outline-style': 'none',
      },
      focus,
      invalid: {
        'border-color': dark
          ? 'color-mix(in oklab, var(--destructive) 50%, transparent)'
          : 'var(--destructive)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) ${dark ? 40 : 20}%, transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'switch-default': recipe({
      base: { width: 'var(--zy-style-switch-width)', height: 'var(--zy-style-switch-height)' },
    }),
    'switch-small': recipe({
      base: {
        width: 'var(--zy-style-switch-width-sm)',
        height: 'var(--zy-style-switch-height-sm)',
      },
    }),
    'switch-thumb': recipe({
      base: { 'border-radius': '9999px', 'background-color': 'var(--zy-style-switch-thumb)' },
    }),
    'switch-checked': recipe({ base: { 'background-color': 'var(--zy-switch-track-checked)' } }),
    'switch-fluid': recipe({
      hover: {
        'background-color':
          'color-mix(in oklab, var(--zy-surface-raised), var(--zy-text-primary) 8%)',
      },
    }),
    'switch-fluid-checked': recipe({
      hover: { 'background-color': 'var(--zy-switch-track-checked-hover)' },
    }),
    heading: recipe({ base: { 'font-family': 'var(--zy-style-font-heading)' } }),
    'fluid-list': recipe({
      base: {
        padding: '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'color-mix(in oklab, var(--muted) 80%, transparent)',
      },
    }),
    'fluid-list-default': recipe({ base: { height: '2.5rem' } }),
    'fluid-list-small': recipe({ base: { height: '2.25rem' } }),
    'fluid-tab': recipe({
      base: {
        ...transition,
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.25rem',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
        opacity: '0.5',
        'outline-style': 'none',
      },
      hover: { color: 'var(--foreground)' },
      selected: {
        color: 'var(--foreground)',
        opacity: '1',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
      focus: {
        'box-shadow':
          '0 0 0 1px var(--muted), 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
      },
    }),
    'fluid-tab-default': recipe({ base: { height: '2rem' } }),
    'fluid-tab-small': recipe({ base: { height: '1.75rem' } }),
    'fluid-indicator': recipe({
      base: {
        'transition-property': 'transform, width, height',
        'transition-duration': '200ms',
        'transition-timing-function': 'var(--zy-style-ease-smooth)',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
    }),
    'fluid-hover-indicator': recipe({
      base: {
        ...transition,
        opacity: '0',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
    }),
    'fluid-hover-visible': recipe({ parentHover: { opacity: '1' }, parentFocus: { opacity: '1' } }),
    check: recipe({
      base: {
        ...transition,
        height: '1rem',
        width: '1rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'outline-style': 'none',
        'background-color': dark
          ? 'color-mix(in oklab, var(--input) 30%, transparent)'
          : 'transparent',
      },
      focus,
      checked: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
      },
      invalid: {
        'border-color': dark
          ? 'color-mix(in oklab, var(--destructive) 50%, transparent)'
          : 'var(--destructive)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) ${dark ? 40 : 20}%, transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'check-field-disabled': recipe({ base: { opacity: '0.5' } }),
    'check-checked-invalid': recipe({ invalid: { 'border-color': 'var(--primary)' } }),
    'check-indicator': recipe({ base: { color: 'currentColor', 'transition-duration': '0s' } }),
    'check-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    range: recipe({ disabled: { opacity: '0.5' } }),
    'range-control': recipe({ base: { height: '1.25rem' } }),
    'range-track': recipe({
      base: {
        height: '0.375rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
      },
    }),
    'range-fill': recipe({ base: { 'background-color': 'var(--primary)' } }),
    'range-thumb': recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'border-radius': '9999px',
        'border-width': '2px',
        'border-style': 'solid',
        'border-color': 'var(--primary)',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
        'outline-style': 'none',
        'transition-property': 'scale',
        'transition-duration': '100ms',
      },
      parentHover: { scale: '1.05' },
      focus: { 'box-shadow': '0 0 0 2px var(--zy-primary-muted)' },
    }),
    'progress-track': recipe({
      base: {
        height: '0.25rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
      },
    }),
    'progress-fill': recipe({
      base: {
        'background-color': 'var(--primary)',
        'transition-property': 'width, transform',
        'transition-duration': '150ms',
      },
    }),
    'progress-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'progress-value': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
        'font-variant-numeric': 'tabular-nums',
      },
    }),
  };
}
