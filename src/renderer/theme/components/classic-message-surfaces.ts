import { recipe } from './recipe';
export function classicMessageSurfaces(dark: boolean) {
  const bubble = {
    'padding-inline': '1rem',
    'padding-block': '0.75rem',
    'border-bottom-right-radius': 'var(--zy-style-radius-md)',
    'line-height': '1.625',
  };
  const motion = {
    'animation-name': 'component-motion',
    'animation-duration': '150ms',
    'animation-timing-function': 'ease',
  };
  return {
    'reasoning-panel': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
        'outline-style': 'none',
      },
    }),
    'reasoning-panel-indented': recipe({ base: { 'padding-left': '1rem' } }),
    'reasoning-panel-open': recipe({
      base: motion,
      motionStart: { opacity: '0', translate: '0 -0.5rem' },
      motionEnd: { opacity: '1', translate: '0 0' },
    }),
    'reasoning-panel-closed': recipe({
      base: motion,
      motionStart: { opacity: '1', translate: '0 0' },
      motionEnd: { opacity: '0', translate: '0 -0.5rem' },
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
    'composer-surface': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-3xl)',
        'box-shadow': 'var(--zy-style-shadow-elevated)',
        'transition-property': 'box-shadow',
        'transition-duration': '150ms',
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    }),
    'composer-input-surface': recipe({ base: { 'border-radius': 'var(--zy-style-radius-3xl)' } }),
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
        'background-color': `color-mix(in oklab, var(--primary) ${dark ? 15 : 10}%, transparent)`,
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--foreground)',
      },
    }),
    'queue-question-content': recipe({ base: { color: 'var(--foreground)' } }),
    'queue-acceptance-content': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
  };
}
