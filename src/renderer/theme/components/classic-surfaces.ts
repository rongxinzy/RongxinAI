import { recipe } from './recipe';
import type { AppearanceStyle, ComponentAppearances } from './contract';

type SurfaceAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `card${string}` | `dialog-${string}` | `popover-${string}`>
>;
function classicSurfaces(): SurfaceAppearances {
  const smallText = { 'font-size': 'var(--zy-component-text-sm)' };
  const title = {
    'font-size': 'var(--zy-component-text-base)',
    'font-weight': 'var(--zy-component-font-weight-medium)',
  };
  const description = { ...smallText, color: 'var(--muted-foreground)' };
  const upper = {
    'border-top-left-radius': 'var(--zy-style-radius-xl)',
    'border-top-right-radius': 'var(--zy-style-radius-xl)',
  };
  const lower = {
    'border-bottom-left-radius': 'var(--zy-style-radius-xl)',
    'border-bottom-right-radius': 'var(--zy-style-radius-xl)',
  };
  const popup: AppearanceStyle = {
    ...smallText,
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
    'outline-style': 'none',
    opacity: '1',
    scale: '1',
    'transition-property': 'opacity, scale',
    'transition-duration': '100ms',
    'transition-timing-function': 'ease-out',
  };
  const hidden = { opacity: '0', scale: '0.95' };
  return {
    card: recipe({
      base: {
        ...smallText,
        gap: '1rem',
        padding: '1rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--card)',
        color: 'var(--card-foreground)',
        'box-shadow': '0 0 0 1px var(--border)',
      },
    }),
    'card-small': recipe({ base: { padding: '0.75rem' } }),
    'card-interactive': recipe({
      base: {
        'transition-property': 'background-color, box-shadow, translate',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)' },
      pressed: { translate: '0 1px' },
      focus: {
        'outline-width': '2px',
        'outline-style': 'solid',
        'outline-color': 'var(--ring)',
        'outline-offset': '2px',
      },
      selected: { 'background-color': 'var(--zy-primary-muted)' },
      disabled: { opacity: '0.5' },
    }),
    'card-header': recipe({ base: { ...upper, 'padding-inline': '1rem' } }),
    'card-title': recipe({ base: { ...title, 'line-height': '1.375' } }),
    'card-title-small': recipe({ base: smallText }),
    'card-description': recipe({ base: description }),
    'card-content': recipe({ base: { 'padding-inline': '1rem' } }),
    'card-footer': recipe({
      base: {
        ...lower,
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)',
        padding: '1rem',
      },
    }),
    'dialog-content': recipe({
      base: {
        ...popup,
        'border-radius': 'var(--zy-style-radius-xl)',
        // Dialogs must read as a solid layer above the page; `--zy-surface` is
        // intentionally translucent for cards and lets page content ghost through.
        'background-color': 'var(--zy-surface-overlay)',
        color: 'var(--zy-surface-foreground)',
        'box-shadow': 'var(--zy-style-shadow-modal)',
        padding: '1rem',
        gap: '1rem',
      },
      entering: hidden,
      exiting: hidden,
    }),
    'dialog-overlay': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 20%, transparent)',
        'backdrop-filter': 'blur(6px)',
        opacity: '1',
        'transition-property': 'opacity',
        'transition-duration': '100ms',
      },
      entering: { opacity: '0' },
      exiting: { opacity: '0' },
    }),
    'dialog-immediate': recipe({ exiting: { 'transition-duration': '0s' } }),
    'dialog-title': recipe({ base: { ...title, 'line-height': '1' } }),
    'dialog-description': recipe({ base: description }),
    'dialog-footer': recipe({
      base: {
        ...lower,
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-top-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        padding: '1rem',
      },
    }),
    'dialog-footer-seamless': recipe({
      base: {
        'background-color': 'transparent',
        'border-top-width': '0',
        padding: '0',
      },
    }),
    'popover-content': recipe({
      base: {
        ...popup,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-md)',
        padding: '0.625rem',
        gap: '0.625rem',
      },
      entering: hidden,
      exiting: hidden,
    }),
    'popover-title': recipe({ base: { 'font-weight': 'var(--zy-component-font-weight-medium)' } }),
    'popover-description': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'popover-header': recipe({ base: smallText }),
  };
}

/** Custom rows and overlays keep their selection predicates and event handlers. */
function classicInteractiveSurfaces() {
  const mix = (token: string, amount: number) =>
    `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;
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
  const session = 'var(--zy-state-session-tint)';
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
      base: {
        ...transition,
        ...border,
        'border-color': 'var(--zy-border-subtle)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      focus,
      pressed,
    }),
    'surface-activity-expandable': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      focus,
      pressed,
    }),
    'surface-agent-row': recipe({
      base: {
        ...transition,
        ...border,
        'border-color': 'transparent',
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      focus,
      pressed,
    }),
    'surface-agent-selected': recipe({
      base: {
        'background-color': mix('sidebar-foreground', 8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'surface-agent-idle': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: {
        'background-color': mix('sidebar-foreground', 6),
        color: 'var(--sidebar-foreground)',
      },
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
    'surface-pending-content': recipe({
      base: {
        'min-height': '2rem',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.25rem',
        'font-weight': '500',
        color: 'var(--foreground)',
      },
    }),
    'surface-pending-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--muted-foreground)' },
    }),
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

function classicMessageSurfaces() {
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

type MenuAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `menu-${string}`>
>;
function classicMenu(): MenuAppearances {
  const highlight = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const danger = {
    'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-tint-percent), transparent)`,
    color: 'var(--destructive)',
  };
  return {
    'menu-positioner': recipe({ base: { 'outline-style': 'none' } }),

    'menu-content': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        padding: '0.25rem',
        'box-shadow': 'var(--zy-style-shadow-md)',
        'outline-style': 'none',
      },
    }),
    'menu-motion': recipe({
      base: {
        opacity: '1',
        scale: '1',
        'transition-property': 'opacity, scale',
        'transition-duration': '100ms',
        'transition-timing-function': 'ease-out',
      },
      entering: { opacity: '0', scale: '0.95' },
      exiting: { opacity: '0', scale: '0.95' },
    }),
    'menu-item': recipe({
      base: {
        'min-height': '2rem',
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.375rem 0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      highlighted: highlight,
      disabled: { opacity: '0.5' },
    }),
    'menu-destructive': recipe({
      base: { color: 'var(--destructive)' },
      hover: danger,
      focus: danger,
      highlighted: danger,
    }),
    'menu-sub-trigger': recipe({ expanded: highlight }),
    'menu-sub-content': recipe({ base: { 'box-shadow': 'var(--zy-style-shadow-lg)' } }),
    'menu-check-item': recipe({ base: { 'padding-inline-end': '2rem' } }),
    'menu-label': recipe({
      base: {
        padding: '0.375rem 0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
      },
    }),
    'menu-inset': recipe({ base: { 'padding-inline-start': '1.75rem' } }),
    'menu-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'menu-shortcut': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
  };
}

type CommandAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `command${string}` | 'task-search-dialog'>
>;
function classicCommand(): CommandAppearances {
  const small = { 'font-size': 'var(--zy-component-text-sm)' };
  const muted = { color: 'var(--muted-foreground)' };
  const highlight = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const input = {
    ...small,
    'border-width': '0px',
    'background-color': 'transparent',
    'outline-style': 'none',
  };
  return {
    'command-list': recipe({ base: { 'outline-style': 'none' } }),

    command: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        padding: '0.25rem',
      },
    }),
    'command-input': recipe({ base: input, disabled: { opacity: '0.5' } }),
    'command-palette-input': recipe({
      base: { ...input, height: '3rem', 'padding-inline': '0.75rem', color: 'var(--foreground)' },
      placeholder: muted,
      disabled: { opacity: '0.5' },
    }),
    'command-input-group': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'color-mix(in oklab, var(--input) 30%, transparent)',
        'background-color': 'var(--zy-surface-raised)',
        'box-shadow': 'none',
      },
      groupFocus: { 'box-shadow': 'none' },
    }),
    'command-item': recipe({
      base: {
        ...small,
        'min-height': '2rem',
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.375rem 0.5rem',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      disabled: { opacity: '0.5' },
    }),
    'command-item-selector': recipe({
      base: {
        'min-height': '2.5rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-block': '0.5rem',
      },
      selected: highlight,
    }),
    'command-item-palette': recipe({
      base: { height: '2rem', 'border-radius': '9999px' },
      selected: highlight,
    }),
    'command-empty': recipe({ base: { ...small, ...muted } }),
    'command-group': recipe({ base: { color: 'var(--foreground)' } }),
    'command-heading': recipe({
      base: {
        ...muted,
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        padding: '0.375rem 0.5rem',
      },
    }),
    'command-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'command-shortcut': recipe({ base: { ...muted, 'font-size': 'var(--zy-component-text-xs)' } }),
    'task-search-dialog': recipe({
      base: { 'border-radius': '16px', padding: '0.25rem', gap: '0px' },
    }),
  };
}

function classicModalEffects() {
  const surface = {
    'background-color': 'var(--zy-surface)',
    'border-radius': 'var(--zy-style-radius-2xl)',
    'box-shadow': 'var(--zy-style-shadow-modal)',
  };
  const border = {
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
  };
  const entrance = {
    'animation-name': 'component-motion',
    'animation-duration': '200ms',
    'animation-timing-function': 'ease-out',
  };
  return {
    'legacy-modal-backdrop': recipe({
      base: {
        ...entrance,
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 10%, transparent)',
      },
      motionStart: { opacity: '0' },
      motionEnd: { opacity: '1' },
    }),
    'legacy-modal-content': recipe({
      base: { ...surface, ...entrance },
      motionStart: { opacity: '0', scale: '0.95' },
      motionEnd: { opacity: '1', scale: '1' },
    }),
    'legacy-permission-inline-surface': recipe({
      base: {
        ...surface,
        ...border,
        'background-color': 'var(--zy-surface-raised)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
      },
    }),
    'local-context-modal': recipe({
      base: {
        ...border,
        'background-color': 'var(--zy-surface)',
        'border-radius': 'var(--zy-style-radius-xl)',
      },
    }),
    'local-capability-modal': recipe({
      base: { ...border, ...surface, 'border-radius': 'var(--zy-style-radius-xl)' },
    }),
    'skill-modal-backdrop': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 60%, transparent)',
      },
    }),
    'skill-security-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-xl)' },
    }),
    'skill-import-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-2xl)' },
    }),
    'composer-near': recipe({ base: { opacity: '0', 'box-shadow': 'none' } }),
    'composer-far': recipe({ base: { opacity: '0', 'box-shadow': 'none' } }),
  };
}

export function classicSurfacesAppearances() {
  return {
    ...classicSurfaces(),
    ...classicInteractiveSurfaces(),
    ...classicMessageSurfaces(),
    ...classicMenu(),
    ...classicCommand(),
    ...classicModalEffects(),
  };
}
