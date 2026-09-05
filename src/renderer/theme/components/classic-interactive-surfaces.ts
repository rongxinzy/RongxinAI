import { recipe } from './recipe';

/** Custom rows and overlays keep their selection predicates and event handlers. */
export function classicInteractiveSurfaces(dark: boolean) {
  const transition = {
    'transition-property': 'color, background-color, border-color, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  const focus = {
    'outline-style': 'none',
    'box-shadow': '0 0 0 2px color-mix(in oklab, var(--ring) 50%, transparent)',
  };
  const pressed = { translate: '0 1px' };
  const border = {
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
  };
  const sidebar = 'color-mix(in srgb, var(--zy-text-primary) 4%, transparent)';
  const session = dark
    ? 'color-mix(in oklab, var(--zy-component-palette-white) 5%, transparent)'
    : 'color-mix(in oklab, var(--zy-component-palette-black) 4%, transparent)';
  const accent = 'color-mix(in oklab, var(--accent) 40%, transparent)';
  const fade = {
    'transition-property': 'opacity',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  return {
    'surface-skill-token': recipe({
      base: {
        ...transition,
        'border-radius': '9999px',
        'background-color': 'var(--zy-skill-blue-background)',
        color: 'var(--zy-skill-blue-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'line-height': '1',
      },
      hover: { 'background-color': 'var(--zy-skill-blue-background)' },
    }),
    'surface-skill-icon': recipe({ base: fade, parentHover: { opacity: '0' } }),
    'surface-skill-fallback': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', 'line-height': '1' },
    }),
    'surface-skill-remove': recipe({
      base: {
        ...fade,
        'border-radius': '9999px',
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'line-height': '1',
        opacity: '0',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-skill-blue-foreground) 10%, transparent)',
      },
      parentHover: { opacity: '1' },
      focus: { opacity: '1', 'outline-style': 'none' },
    }),
    'surface-code-preview': recipe({
      base: {
        ...border,
        'border-radius': 'var(--zy-style-radius-xl)',
        'box-shadow': 'var(--zy-style-shadow-2xl)',
      },
    }),
    'surface-markdown-link': recipe({
      base: {
        ...transition,
        color: 'var(--primary)',
        'text-decoration': 'underline',
        'text-decoration-color': 'color-mix(in oklab, var(--primary) 50%, transparent)',
      },
      hover: { color: 'var(--zy-primary-hover)', 'text-decoration-color': 'var(--primary)' },
    }),
    'surface-provider-row': recipe({
      base: {
        ...transition,
        ...border,
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--zy-surface)',
      },
      focus,
      pressed,
    }),
    'surface-provider-selected': recipe({
      base: { 'box-shadow': 'var(--zy-style-shadow-elevated)', 'border-color': 'var(--border)' },
    }),
    'surface-provider-idle': recipe({
      base: { 'border-color': 'transparent' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'surface-provider-link': recipe({
      base: {
        color: 'var(--primary)',
        'font-size': 'var(--zy-component-text-xs)',
        'text-decoration': 'underline',
      },
    }),
    'surface-settings-row': recipe({
      base: { ...transition, 'transition-timing-function': 'ease-out' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      focus,
      pressed,
    }),
    'surface-settings-link': recipe({
      base: {
        ...transition,
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
      },
      hover: { color: 'var(--primary)', 'text-decoration': 'underline' },
    }),
    'surface-activity-row': recipe({
      base: { ...transition, 'border-radius': 'var(--zy-style-radius-lg)' },
    }),
    'surface-activity-expandable': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'surface-agent-row': recipe({
      base: {
        ...transition,
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      focus,
      pressed,
    }),
    'surface-agent-selected': recipe({
      base: { 'background-color': sidebar, color: 'var(--foreground)' },
    }),
    'surface-agent-idle': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { 'background-color': sidebar, color: 'var(--foreground)' },
    }),
    'surface-agent-inactive': recipe({
      base: { 'background-color': 'transparent', color: 'var(--zy-text-secondary)' },
    }),
    'surface-file-row': recipe({
      base: { ...transition, 'font-size': 'var(--zy-component-text-sm)' },
      focus,
      pressed,
    }),
    'surface-file-selected': recipe({
      base: {
        'background-color': 'color-mix(in oklab, var(--primary) 10%, transparent)',
        color: 'var(--primary)',
      },
    }),
    'surface-file-idle': recipe({
      base: { color: 'var(--foreground)' },
      hover: { 'background-color': 'var(--zy-surface)' },
    }),
    'surface-session-overlay': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 10%, transparent)',
      },
    }),
    'surface-session-row': recipe({
      base: { ...transition, 'border-radius': 'var(--zy-style-radius-lg)' },
      focus,
      pressed,
    }),
    'surface-session-selected': recipe({ base: { 'background-color': session } }),
    'surface-session-idle': recipe({ hover: { 'background-color': session } }),
    'surface-image-overlay': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-neutral-950) 70%, transparent)',
        'backdrop-filter': 'blur(8px)',
      },
    }),
    'surface-skill-editor': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.5rem',
        color: 'var(--foreground)',
        'outline-style': 'none',
      },
      disabled: { opacity: '0.5' },
    }),
    'surface-skill-placeholder': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'surface-pending-row': recipe({
      base: {
        ...transition,
        'border-bottom-width': '1px',
        'border-color': 'color-mix(in oklab, var(--border) 70%, transparent)',
      },
      hover: { 'background-color': accent },
      focus,
      pressed,
    }),
    'surface-pending-selected': recipe({ base: { 'background-color': accent } }),
    'surface-pending-failed': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--destructive) 5%, transparent)' },
    }),
    'surface-pending-last': recipe({ base: { 'border-bottom-width': '0px' } }),
    'surface-market-link': recipe({
      base: { 'border-radius': 'var(--zy-style-radius-sm)' },
      hover: { 'text-decoration': 'underline' },
      focus: { 'outline-width': '2px', 'outline-style': 'solid', 'outline-color': 'var(--ring)' },
    }),
    'surface-provider-dialog': recipe({
      base: {
        ...border,
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--background)',
        'box-shadow': 'var(--zy-style-shadow-xl)',
      },
    }),
    'surface-todo-row': recipe({
      base: {
        ...transition,
        ...border,
        'border-color': 'var(--zy-border-subtle)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
      },
      hover: { 'background-color': 'var(--muted)' },
      focus: {
        'border-color': 'var(--ring)',
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 30%, transparent)',
      },
      pressed,
    }),
  };
}
