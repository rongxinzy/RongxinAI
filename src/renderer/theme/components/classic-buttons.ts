import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;

type ButtonAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `button${string}`>
>;

function classicButtons(): ButtonAppearances {
  const hover = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const raised = { 'background-color': 'var(--zy-surface-raised)' };
  const small = { 'border-radius': 'var(--zy-style-radius-md)' };
  return {
    button: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-style': 'solid',
        'border-width': '1px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow, translate',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 3px ${mix('ring', 50)}` },
      pressed: { translate: '0 1px' },
      disabled: { opacity: '0.5' },
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
    }),
    'button-default': recipe({
      base: { 'background-color': 'var(--zy-primary-strong)', color: 'var(--primary-foreground)' },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-primary-strong) 90%, black)',
      },
    }),
    'button-outline': recipe({
      base: {
        'border-color': 'var(--zy-state-input-border)',
        'background-color': 'var(--zy-state-input-solid)',
      },
      hover: { ...hover, 'background-color': 'var(--zy-state-input-hover)' },
      expanded: hover,
    }),
    'button-secondary': recipe({
      base: { 'background-color': 'var(--secondary)', color: 'var(--secondary-foreground)' },
      hover: { 'background-color': 'color-mix(in oklch, var(--secondary), var(--foreground) 5%)' },
      expanded: { 'background-color': 'var(--secondary)', color: 'var(--secondary-foreground)' },
    }),
    'button-ghost': recipe({
      hover: { ...hover, 'background-color': 'var(--zy-state-muted-hover)' },
      expanded: hover,
    }),
    'button-embedded': recipe({
      base: { color: 'inherit', 'background-color': 'transparent' },
    }),
    'button-prompt-selector': recipe({
      base: { 'transition-duration': '150ms' },
      hover: { ...raised, color: 'var(--foreground)' },
      expanded: { ...raised, color: 'var(--foreground)' },
    }),
    'button-navigation': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'transition-duration': '150ms',
      },
      hover: {
        'background-color': mix('sidebar-foreground', 6),
        color: 'var(--sidebar-foreground)',
      },
      selected: {
        'background-color': mix('sidebar-foreground', 8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),

    'button-toolbar': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { ...raised, color: 'var(--foreground)' },
      expanded: { ...raised, color: 'var(--foreground)' },
    }),
    'button-destructive': recipe({
      base: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-tint-percent), transparent)`,
        color: 'var(--destructive)',
      },
      hover: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-hover-tint-percent), transparent)`,
      },
      focus: {
        'border-color': mix('destructive', 40),
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
    }),
    'button-link': recipe({
      base: { color: 'var(--primary)', 'text-underline-offset': '4px' },
      hover: { 'text-decoration': 'underline' },
    }),
    'button-appearance': recipe({
      base: { 'border-color': 'var(--border)', 'background-color': 'var(--background)' },
      hover: { 'background-color': 'var(--muted)' },
      selected: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--background)',
        color: 'var(--primary)',
      },
    }),
    'button-size-default': recipe({
      base: { height: '2rem', gap: '0.5rem', 'padding-inline': '0.875rem' },
    }),
    'button-size-xs': recipe({
      base: {
        ...small,
        height: '1.5rem',
        gap: '0.25rem',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'button-size-sm': recipe({
      base: { ...small, height: '1.75rem', gap: '0.375rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-lg': recipe({
      base: { height: '2.25rem', gap: '0.5rem', 'padding-inline': '1rem' },
    }),
    'button-size-appearance': recipe({
      base: {
        height: 'auto',
        gap: '0.5rem',
        padding: '0.75rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'button-size-navigation': recipe({
      base: { height: '2rem', gap: '0.5rem', 'padding-inline': '0.75rem' },
    }),
    'button-size-icon': recipe({ base: { height: '2rem', width: '2rem' } }),
    'button-size-icon-xs': recipe({ base: { ...small, height: '1.5rem', width: '1.5rem' } }),
    'button-size-icon-sm': recipe({ base: { ...small, height: '1.75rem', width: '1.75rem' } }),
    'button-size-icon-lg': recipe({ base: { height: '2.25rem', width: '2.25rem' } }),
  };
}

type BadgeAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `badge${string}`>
>;
function classicBadges(): BadgeAppearances {
  return {
    badge: recipe({
      base: {
        '--zy-control-icon-size': '0.75rem',
        height: '1.375rem',
        gap: '0.25rem',
        padding: '0 0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-style': 'solid',
        'border-width': '1px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1',
        'font-variant-numeric': 'tabular-nums',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 2px ${mix('ring', 50)}` },
      invalid: {
        'border-color': 'var(--destructive)',
        'box-shadow': `0 0 0 2px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'badge-default': recipe({
      base: {
        'background-color': 'var(--zy-primary-muted)',
        'border-color': mix('primary', 24),
        color: 'var(--primary)',
      },
    }),
    'badge-secondary': recipe({
      base: {
        'background-color': 'var(--secondary)',
        'border-color': 'var(--zy-border)',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-destructive': recipe({
      base: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-tint-percent), transparent)`,
        'border-color': mix('destructive', 24),
        color: 'var(--destructive)',
      },
      focus: {
        'box-shadow': `0 0 0 2px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
    }),
    'badge-outline': recipe({
      base: {
        'border-color': 'var(--zy-input-border)',
        'background-color': 'transparent',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-ghost': recipe({
      hover: {
        'background-color': 'var(--zy-state-muted-hover)',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-link': recipe({
      base: { color: 'var(--primary)', 'text-underline-offset': '4px' },
      hover: { 'text-decoration': 'underline' },
    }),
    'badge-default-link': recipe({ hover: { 'background-color': mix('primary', 80) } }),
    'badge-secondary-link': recipe({ hover: { 'background-color': mix('secondary', 80) } }),
    'badge-destructive-link': recipe({ hover: { 'background-color': mix('destructive', 20) } }),
    'badge-outline-link': recipe({
      hover: { 'background-color': 'var(--muted)', color: 'var(--muted-foreground)' },
    }),
  };
}

type SelectAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `select-${string}`>
>;
function classicSelect(): SelectAppearances {
  const highlight = { 'background-color': 'var(--accent)', color: 'var(--accent-foreground)' };
  return {
    'select-trigger': recipe({
      base: {
        height: '2rem',
        gap: '0.375rem',
        'padding-block': '0.5rem',
        'padding-inline-start': '0.625rem',
        'padding-inline-end': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-text-muted)',
        'background-color': 'var(--zy-state-input-solid)',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: {
        'border-color': 'var(--zy-text-muted)',
        'background-color': 'var(--zy-state-input-hover)',
      },
      focus: {
        'border-color': 'var(--primary)',
        'outline-color': 'var(--primary)',
        'outline-width': '2px',
        'outline-style': 'solid',
        'outline-offset': '1px',
        'box-shadow': 'none',
      },
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 1px ${mix('destructive', 40)}`,
      },
      disabled: { opacity: '0.5' },
      empty: { color: 'var(--muted-foreground)' },
    }),
    'select-trigger-small': recipe({
      base: { height: '1.75rem', 'border-radius': 'var(--zy-style-radius-md)' },
    }),
    'select-item': recipe({
      base: {
        'min-height': '2rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-block': '0.375rem',
        'padding-inline-start': '0.5rem',
        'padding-inline-end': '2rem',
        gap: '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      highlighted: highlight,
      disabled: { opacity: '0.5' },
    }),
    'select-label': recipe({
      base: {
        padding: '0.375rem 0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
      },
    }),
    'select-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'select-scroll': recipe({ base: { 'background-color': 'var(--popover)' } }),
    'select-icon': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'select-content': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-md)',
        opacity: '1',
        scale: '1',
        'transition-property': 'opacity, scale',
        'transition-duration': '100ms',
        'transition-timing-function': 'ease-out',
      },
      entering: { opacity: '0', scale: '0.95' },
      exiting: { opacity: '0', scale: '0.95' },
    }),
  };
}

function classicFields() {
  return {
    'field-legend': recipe({ base: { 'font-weight': 'var(--zy-component-font-weight-medium)' } }),
    'field-legend-label': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'field-legend-heading': recipe({ base: { 'font-size': 'var(--zy-component-text-base)' } }),
    field: recipe({ base: {}, invalid: { color: 'var(--destructive)' } }),
    'field-content': recipe({ base: { 'line-height': '1.375' } }),
    'field-label': recipe({ base: { 'line-height': '1.375' } }),
    'field-label-disabled': recipe({ base: { opacity: '0.5' } }),
    'field-label-card': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
      },
    }),
    'field-label-inset': recipe({ base: { padding: '0.625rem' } }),
    'field-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'field-description': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.5',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'field-link': recipe({
      base: { 'text-decoration': 'underline', 'text-underline-offset': '4px' },
      hover: { color: 'var(--primary)' },
    }),
    'field-separator': recipe({
      base: { height: '1.25rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'field-separator-content': recipe({
      base: {
        'background-color': 'var(--background)',
        'padding-inline': '0.5rem',
        color: 'var(--muted-foreground)',
      },
    }),
    'field-error': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--destructive)',
      },
    }),
    toast: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'var(--border)',
        'box-shadow': 'var(--zy-style-shadow-xl)',
        'animation-name': 'component-motion',
        'animation-duration': '0.2s',
        'animation-timing-function': 'ease-out',
      },
      motionStart: { opacity: '0', translate: '0 -8px' },
      motionEnd: { opacity: '1', translate: '0 0' },
    }),
    'toast-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'field-label-checked': recipe({
      base: {
        'border-color': `color-mix(in oklab, var(--primary) var(--zy-state-primary-border-tint-percent), transparent)`,
        'background-color': `color-mix(in oklab, var(--primary) var(--zy-state-primary-fill-tint-percent), transparent)`,
      },
    }),
    'control-caption': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'control-caption-muted': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
    'control-label-strong': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
  };
}

export function classicControlsAppearances() {
  return {
    ...classicButtons(),
    ...classicBadges(),
    ...classicSelect(),
    ...classicFields(),
  };
}
