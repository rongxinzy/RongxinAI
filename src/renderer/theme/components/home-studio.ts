import { recipe } from './recipe';

/** Studio home surfaces inherit every package's colors and typography. */
export function homeStudioAppearances() {
  return {
    'home-brand': recipe({ base: { height: '1.25rem' } }),
    'home-greeting': recipe({
      base: {
        'font-size': 'var(--zy-component-text-2xl)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': 'var(--zy-component-text-2xl--line-height)',
        color: 'var(--foreground)',
        'text-align': 'center',
      },
    }),
    'home-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'line-height': 'var(--zy-component-text-sm--line-height)',
        color: 'var(--foreground)',
      },
    }),
    'home-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': 'var(--zy-component-text-sm--line-height)',
        color: 'var(--zy-text-muted)',
        'text-align': 'center',
      },
    }),
    'home-footnote': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        color: 'var(--zy-text-muted)',
        'text-align': 'center',
      },
    }),
    'home-composer': recipe({
      base: {
        'background-color': 'var(--card)',
        'border-radius': 'var(--zy-style-radius-3xl)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
        padding: '1rem 0.75rem 0.75rem',
        'transition-property': 'border-color, box-shadow',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      composerFocus: {
        'border-color': 'var(--zy-text-muted)',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
    }),
    'home-composer-well': recipe({
      base: {
        'background-color': 'transparent',
        'border-width': '0px',
        'box-shadow': 'none',
        height: 'auto',
      },
      hover: { 'border-color': 'transparent', 'box-shadow': 'none' },
      groupFocus: { 'border-color': 'transparent', 'box-shadow': 'none' },
      composerFocus: { 'border-color': 'transparent', 'box-shadow': 'none' },
    }),
    'home-sticky': recipe({ base: { 'background-color': 'transparent' } }),
    'home-prompt-editor': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
        'min-height': '3rem',
        color: 'var(--foreground)',
      },
      placeholder: { color: 'var(--zy-text-muted)' },
    }),
    'home-folder-warning': recipe({
      base: {
        padding: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--popover)',
        color: 'var(--foreground)',
        'font-size': 'var(--zy-component-text-xs)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
    'shell-canvas': recipe({
      base: {
        'background-color': 'var(--background)',
        'border-radius': 'var(--zy-style-radius-xl)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
    }),
    'home-status': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        color: 'var(--zy-text-muted)',
        gap: '0.375rem',
      },
    }),
    'home-status-dot': recipe({
      base: {
        width: '6px',
        height: '6px',
        'border-radius': '9999px',
        'background-color': 'var(--zy-success)',
      },
    }),
    'home-status-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--zy-text-muted)' },
    }),
    'home-status-fading': recipe({ base: { opacity: '0' } }),
  };
}
