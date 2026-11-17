import { recipe } from './recipe';
export function classicMessageSurfaces() {
  const bubble = {
    'padding-inline': '1rem',
    'padding-block': '0.75rem',
    'border-bottom-right-radius': 'var(--zy-style-radius-md)',
    'line-height': '1.625',
  };
  const motion = {
    'animation-name': 'component-motion',
    'animation-duration': '160ms',
    'animation-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
  };
  return {
    'reasoning-panel': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.6',
        color: 'var(--zy-text-muted)',
        'outline-style': 'none',
      },
    }),
    'reasoning-panel-indented': recipe({
      base: {
        'padding-left': '1rem',
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-border)',
      },
    }),
    'reasoning-panel-open': recipe({
      base: motion,
      motionStart: { opacity: '0' },
      motionEnd: { opacity: '1' },
    }),
    'reasoning-panel-closed': recipe({
      base: motion,
      motionStart: { opacity: '1' },
      motionEnd: { opacity: '0' },
    }),
    'message-body': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'message-role-user': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--secondary)',
        'padding-inline': '1rem',
        'padding-block': '0.75rem',
        color: 'var(--foreground)',
      },
    }),
    'message-role-assistant': recipe({ base: { color: 'var(--foreground)' } }),
    'queue-body': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'queue-body-completed': recipe({
      base: {
        color: 'color-mix(in oklab, var(--muted-foreground) 50%, transparent)',
        'text-decoration': 'line-through',
      },
    }),
    'composer-backdrop': recipe({
      base: {
        'background-color': 'var(--background)',
        'border-top-left-radius': 'var(--zy-style-radius-3xl)',
        'border-top-right-radius': 'var(--zy-style-radius-3xl)',
        'padding-bottom': '1rem',
      },
    }),
    'composer-surface': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-3xl)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
        'transition-property': 'box-shadow',
        'transition-duration': '150ms',
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      composerFocus: { 'box-shadow': 'var(--zy-style-shadow-md)' },
    }),
    'composer-input-surface': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-3xl)',
        'background-color': 'var(--zy-surface-overlay)',
        'border-color': 'var(--border)',
      },
      groupFocus: { 'border-color': 'var(--ring)', 'box-shadow': 'none' },
      composerFocus: { 'border-color': 'var(--ring)', 'box-shadow': 'none' },
    }),
    'composer-drop-active': recipe({
      base: { 'box-shadow': '0 0 0 2px var(--primary), var(--zy-style-shadow-elevated)' },
    }),
    'message-code-user': recipe({
      base: {
        ...bubble,
        'border-radius': 'var(--zy-style-radius-xl)',
        'border-bottom-right-radius': 'var(--zy-style-radius-md)',
        'background-color': 'color-mix(in oklab, var(--primary) 10%, transparent)',
      },
    }),
    'message-cowork-user': recipe({
      base: {
        ...bubble,
        'border-radius': 'var(--zy-style-radius-2xl)',
        'border-bottom-right-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--secondary)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--foreground)',
      },
    }),
  };
}
