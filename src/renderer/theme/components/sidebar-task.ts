import { recipe } from './recipe';

/** The row owns its surface; the title button only supplies focus and activation. */
export function sidebarTaskAppearances() {
  const transition = {
    'transition-property': 'color, background-color, border-color, box-shadow, opacity, translate',
    'transition-duration': '120ms',
    'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
  } as const;
  return {
    'shell-sidebar-task': recipe({
      base: {
        ...transition,
        height: '2rem',
        padding: '0px',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-radius': 'var(--zy-style-radius-lg)',
      },
      pressed: { 'background-color': 'var(--sidebar-accent)' },
    }),
    'shell-sidebar-task-selected': recipe({
      base: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'shell-sidebar-task-idle': recipe({
      base: { 'background-color': 'transparent', color: 'var(--zy-text-primary)' },
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
    }),
    'shell-sidebar-task-main': recipe({
      base: {
        ...transition,
        height: '2rem',
        'padding-left': '0.625rem',
        'padding-right': '0.625rem',
        'background-color': 'transparent',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-weight': 'inherit',
        'text-align': 'left',
        color: 'inherit',
        'border-radius': 'var(--zy-style-radius-lg)',
      },
      hover: { 'background-color': 'transparent' },
      pressed: { 'background-color': 'transparent', translate: '0px 1px' },
      focus: {
        'outline-color': 'var(--ring)',
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-offset': '1px',
        'box-shadow': 'none',
      },
    }),
  };
}
