import { recipe } from './recipe';

/** Product state hooks share behavior with Button/Badge, but own their appearance. */
export function classicLocalControls() {
  const transparent = recipe({
    base: { 'background-color': 'transparent' },
    hover: { 'background-color': 'transparent' },
    expanded: { 'background-color': 'transparent' },
  });
  const status = (name: 'primary' | 'success' | 'destructive') =>
    recipe({
      base: {
        'border-color': `color-mix(in srgb, var(--zy-${name}) 32%, transparent)`,
        'background-color': `color-mix(in srgb, var(--zy-${name}) 12%, var(--zy-background))`,
        color: `var(--zy-${name})`,
      },
    });
  const danger = (color: string) =>
    recipe({
      base: {
        'background-color': color,
        'border-color': color,
        color: 'var(--zy-destructive-foreground)',
      },
      hover: {
        'background-color': `color-mix(in srgb, ${color} 88%, black)`,
        'border-color': `color-mix(in srgb, ${color} 88%, black)`,
        color: 'var(--zy-destructive-foreground)',
      },
    });
  return {
    'workspace-row-button': structuredClone(transparent),
    'todo-queue-trigger': structuredClone(transparent),
    'local-model-action': recipe({
      base: {
        'transition-property': 'background-color, border-color, box-shadow, filter, translate',
        'transition-duration': '200ms, 200ms, 200ms, 200ms, 120ms',
        'transition-timing-function': 'ease-out',
      },
      pressed: { translate: '0 1px' },
    }),
    'local-launch-status': recipe({
      base: {
        height: '22px',
        'padding-block': '0px',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface-raised)',
        color: 'var(--zy-text-muted)',
        'line-height': '1',
      },
    }),
    'local-launch-starting': status('primary'),
    'local-launch-succeeded': status('success'),
    'local-launch-failed': status('destructive'),
    'local-launch-close': recipe({
      base: {
        'transition-property': 'background-color, color',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease',
      },
      hover: {
        'background-color': 'var(--zy-destructive)',
        color: 'var(--zy-destructive-foreground)',
      },
    }),
    'local-launch-close-icon': recipe({ base: { color: 'inherit' } }),
    'local-secondary-action': recipe({
      base: { color: 'var(--zy-text-secondary)' },
      hover: { color: 'var(--zy-text-secondary)' },
    }),
    'local-secondary-icon': recipe({ base: { color: 'inherit' } }),
    'local-unload-action': danger('var(--zy-destructive)'),
    'local-delete-confirm': danger('var(--zy-style-destructive-confirm)'),
    'local-delete-action': recipe({ hover: { 'box-shadow': 'none' } }),
    'local-delete-cancel': recipe({
      hover: {
        'background-color': 'var(--zy-surface-raised)',
        'border-color': 'transparent',
        color: 'var(--zy-foreground)',
      },
    }),
  };
}
