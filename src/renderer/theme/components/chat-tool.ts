import { recipe } from './recipe';

/** Compact transcript activity, inherited by every registered theme. */
export function chatToolAppearances() {
  return {
    'chat-tool': recipe({
      base: { 'border-width': '0px', 'background-color': 'transparent', 'box-shadow': 'none' },
    }),
    'chat-tool-trigger': recipe({
      base: {
        'min-height': '2rem',
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
        'text-align': 'left',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      focus: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--ring)',
        'outline-offset': '1px',
      },
      disabled: { opacity: '0.5' },
    }),
    'chat-tool-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--zy-text-muted)' },
    }),
    'chat-tool-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
    'chat-tool-summary': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-family': 'var(--zy-style-font-mono)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'chat-tool-status': recipe({
      base: {
        '--zy-control-icon-size': '0.875rem',
        height: 'auto',
        padding: '0px',
        'border-width': '0px',
        'border-radius': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-xs)',
        'font-variant-numeric': 'tabular-nums',
        color: 'var(--zy-text-muted)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
    }),
    'chat-tool-warning': recipe({ base: { color: 'var(--zy-warning)' } }),
    'chat-tool-error': recipe({ base: { color: 'var(--destructive)' } }),
    'chat-tool-chevron': recipe({
      base: {
        width: '1rem',
        height: '1rem',
        color: 'var(--zy-text-muted)',
        rotate: '0deg',
        'transition-property': 'rotate, color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
    }),
    'chat-tool-chevron-open': recipe({ base: { rotate: '180deg' } }),
    'chat-tool-content': recipe({
      base: {
        'padding-left': '1rem',
        'padding-top': '0.375rem',
        'padding-bottom': '0.5rem',
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-border)',
        color: 'var(--foreground)',
      },
    }),
    'chat-tool-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'chat-tool-output-error': recipe({ base: { color: 'var(--destructive)' } }),
  };
}
