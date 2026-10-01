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
        'padding-block': '0.375rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--muted-foreground)',
        'text-align': 'left',
        'transition-property': 'color, background-color',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--foreground)' },
      focus: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--ring)',
        'outline-offset': '2px',
      },
      disabled: { opacity: '0.5' },
    }),
    'chat-tool-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'chat-tool-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'chat-tool-summary': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
    'chat-tool-status': recipe({
      base: {
        height: 'auto',
        padding: '0px',
        'border-width': '0px',
        'border-radius': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
        color: 'var(--muted-foreground)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
    }),
    'chat-tool-warning': recipe({ base: { color: 'var(--zy-warning)' } }),
    'chat-tool-error': recipe({ base: { color: 'var(--destructive)' } }),
    'chat-tool-chevron': recipe({
      base: {
        width: '1rem',
        height: '1rem',
        rotate: '0deg',
        'transition-property': 'rotate',
        'transition-duration': '150ms',
      },
    }),
    'chat-tool-chevron-open': recipe({ base: { rotate: '180deg' } }),
    'chat-tool-content': recipe({
      base: {
        'padding-left': '1rem',
        'padding-top': '0.5rem',
        'padding-bottom': '0.75rem',
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-border-subtle)',
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
