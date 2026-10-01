import { recipe } from './recipe';

const surface = (amount: number) =>
  `color-mix(in oklab, var(--sidebar-foreground) ${amount}%, transparent)`;
const feedback = {
  'transition-property': 'color, background-color, box-shadow, translate',
  'transition-duration': '120ms',
  'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;
const focus = {
  'outline-style': 'solid',
  'outline-width': '2px',
  'outline-color': 'var(--sidebar-ring)',
  'outline-offset': '-2px',
} as const;

export function shellSidebarAppearances() {
  return {
    'shell-sidebar': recipe({
      base: {
        'background-color': 'var(--sidebar)',
        color: 'var(--sidebar-foreground)',
        'border-right-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
      },
    }),
    'shell-sidebar-header': recipe({
      base: {
        height: '2.5rem',
        'padding-inline': '0.5rem',
        'border-bottom-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
      },
    }),
    'shell-sidebar-logo': recipe({ base: { height: '1rem' } }),
    'shell-sidebar-section': recipe({
      base: {
        height: '1.75rem',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'background-color': 'var(--sidebar)',
      },
    }),
    'shell-sidebar-scroll': recipe({
      base: { 'padding-inline': '0.5rem', 'padding-bottom': '0.5rem' },
    }),
    'shell-sidebar-footer': recipe({
      base: {
        'padding-inline': '0.5rem',
        'padding-block': '0.5rem',
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
      },
    }),
    'shell-sidebar-nav': recipe({
      base: {
        ...feedback,
        height: '2rem',
        gap: '0.5rem',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '0px',
        'box-shadow': 'none',
        'background-color': 'transparent',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': surface(5), color: 'var(--sidebar-foreground)' },
      pressed: { 'background-color': surface(10), translate: '0px 1px' },
      focus,
      disabled: { opacity: '0.5' },
    }),
    'shell-sidebar-nav-selected': recipe({
      base: {
        'background-color': surface(8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      hover: { 'background-color': surface(10), color: 'var(--sidebar-foreground)' },
      selected: {
        'background-color': surface(8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      pressed: { 'background-color': surface(12) },
    }),
    'shell-sidebar-task': recipe({
      base: {
        ...feedback,
        height: '2rem',
        padding: '0px',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-radius': 'var(--zy-style-radius-md)',
      },
    }),
    'shell-sidebar-task-selected': recipe({
      base: {
        'background-color': surface(8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'shell-sidebar-task-idle': recipe({
      base: { 'background-color': 'transparent', color: 'var(--muted-foreground)' },
      hover: { 'background-color': surface(5), color: 'var(--sidebar-foreground)' },
    }),
    'shell-sidebar-task-main': recipe({
      base: {
        ...feedback,
        height: '2rem',
        'padding-left': '0.625rem',
        'padding-right': '3.625rem',
        'background-color': 'transparent',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-weight': 'inherit',
        'text-align': 'left',
        color: 'inherit',
        'border-radius': 'var(--zy-style-radius-md)',
      },
      hover: { 'background-color': 'transparent' },
      pressed: { 'background-color': surface(10), translate: '0px 1px' },
      focus,
    }),
    'shell-sidebar-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'shell-sidebar-workspace': recipe({
      base: {
        ...feedback,
        height: '2rem',
        'background-color': 'var(--sidebar)',
        color: 'var(--muted-foreground)',
        'border-radius': 'var(--zy-style-radius-md)',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--sidebar-foreground) 5%, var(--sidebar))',
        color: 'var(--sidebar-foreground)',
      },
      selected: {
        'background-color': 'color-mix(in oklab, var(--sidebar-foreground) 8%, var(--sidebar))',
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'shell-sidebar-workspace-main': recipe({
      base: {
        ...feedback,
        height: '2rem',
        'padding-inline': '0.625rem',
        gap: '0.5rem',
        color: 'inherit',
        'font-weight': 'inherit',
        'text-align': 'left',
        'border-width': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'transparent' },
      expanded: { 'background-color': 'transparent', color: 'inherit' },
      pressed: { translate: '0px 1px' },
      focus,
    }),
    'shell-sidebar-approval': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--zy-warning)' },
    }),
    'shell-sidebar-action': recipe({
      base: {
        ...feedback,
        opacity: '0',
        color: 'var(--muted-foreground)',
        'border-width': '0px',
        'box-shadow': 'none',
      },
      parentHover: { opacity: '1' },
      parentFocus: { opacity: '1' },
      hover: { color: 'var(--sidebar-foreground)', 'background-color': surface(10) },
      focus: { ...focus, opacity: '1' },
      expanded: { opacity: '1', 'background-color': surface(10) },
    }),
    'shell-sidebar-resize': recipe({
      base: { 'background-color': 'transparent' },
      hover: { 'background-color': surface(5) },
    }),
    'shell-sidebar-resizing': recipe({ base: { 'background-color': surface(10) } }),
    'shell-sidebar-fade': recipe({
      base: {
        height: '2rem',
        'transition-property': 'opacity',
        'transition-duration': '120ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'shell-sidebar-fade-top': recipe({
      base: { 'background-image': 'linear-gradient(to bottom, var(--sidebar), transparent)' },
    }),
    'shell-sidebar-fade-bottom': recipe({
      base: { 'background-image': 'linear-gradient(to top, var(--sidebar), transparent)' },
    }),
    'shell-mode': recipe({
      base: {
        height: '1.75rem',
        width: '100%',
        'border-width': '0px',
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': surface(4),
        'box-shadow': 'none',
      },
      checked: { 'background-color': surface(4) },
      focus,
    }),
    'shell-mode-thumb': recipe({
      base: {
        height: '1.5rem',
        width: 'calc(50% - 4px)',
        'border-radius': 'var(--zy-style-work-chat-thumb-radius)',
        'background-color': 'var(--zy-style-work-chat-thumb)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
        'transition-property': 'translate',
        'transition-duration': '160ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'shell-mode-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'shell-mode-label-selected': recipe({
      base: {
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-switch-thumb-foreground)',
      },
    }),
  };
}
