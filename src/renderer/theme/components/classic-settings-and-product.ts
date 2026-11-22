import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

function classicPromptActions() {
  const raised = { 'background-color': 'var(--zy-surface-raised)', 'box-shadow': 'none' };
  const compact = { 'padding-inline': '0.5rem', 'font-size': 'var(--zy-component-text-sm)' };
  const sidebar = {
    'background-color': 'color-mix(in srgb, var(--zy-text-primary) 4%, transparent)',
  };
  return {
    'fold-compact': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'fold-settings': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      focused: {
        'outline-style': 'none',
        'box-shadow': '0 0 0 2px var(--background), 0 0 0 4px var(--primary)',
      },
    }),
    'fold-reasoning': recipe({
      base: {
        'min-height': '2rem',
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      focused: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--ring)',
        'outline-offset': '1px',
      },
    }),
    'prompt-compact-action': recipe({
      base: compact,
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'prompt-raised-action': recipe({ hover: raised, expanded: raised }),
    'prompt-hover-action': recipe({ hover: raised }),
    'prompt-folder-action': recipe({ base: compact, hover: raised, expanded: raised }),
    'prompt-folder-warning': recipe({
      base: { 'box-shadow': '0 0 0 1px var(--zy-warning)', color: 'var(--zy-warning)' },
      hover: { 'box-shadow': '0 0 0 1px var(--zy-warning)' },
      expanded: { 'box-shadow': '0 0 0 1px var(--zy-warning)' },
    }),
    'prompt-expert-chip': recipe({
      base: {
        ...compact,
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'transparent',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)' },
    }),
    'prompt-skills-action': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--primary)' },
    }),
    'sidebar-common-surface': recipe({ hover: sidebar, expanded: sidebar }),
    'sidebar-common-active': recipe({ base: sidebar }),
    'sidebar-common-inactive': recipe({
      base: { 'background-color': 'transparent', color: 'var(--zy-text-secondary)' },
    }),
  };
}

function classicSupplementaryControls() {
  const focus = {
    'border-color': 'var(--ring)',
    'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
  };
  const transition = {
    'transition-property': 'color, background-color, border-color, opacity, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'ease-out',
  };
  return {
    switch: recipe({
      base: {
        // An unchecked switch must stay legible on every surface: a surface-raised
        // track disappears into white cards and its thumb matched the track in dark.
        'background-color': 'color-mix(in oklab, var(--zy-foreground) 14%, var(--zy-background))',
        'box-shadow': 'none',
        'transition-property': 'background-color, box-shadow',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-input-border)',
        'outline-style': 'none',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-foreground) 20%, var(--zy-background))',
      },
      focus,
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'switch-default': recipe({
      base: { width: 'var(--zy-style-switch-width)', height: 'var(--zy-style-switch-height)' },
    }),
    'switch-small': recipe({
      base: {
        width: 'var(--zy-style-switch-width-sm)',
        height: 'var(--zy-style-switch-height-sm)',
      },
    }),
    'switch-thumb': recipe({
      base: {
        'border-radius': '9999px',
        'background-color': 'var(--zy-style-switch-thumb)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
    }),
    'switch-checked': recipe({ base: { 'background-color': 'var(--zy-switch-track-checked)' } }),
    'switch-fluid': recipe({
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-foreground) 20%, var(--zy-background))',
      },
    }),
    'switch-fluid-checked': recipe({
      hover: { 'background-color': 'var(--zy-switch-track-checked-hover)' },
    }),
    heading: recipe({ base: { 'font-family': 'var(--zy-style-font-heading)' } }),
    'fluid-list': recipe({
      base: {
        padding: '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'color-mix(in oklab, var(--muted) 80%, transparent)',
      },
    }),
    'fluid-list-default': recipe({ base: { height: '2.5rem' } }),
    'fluid-list-small': recipe({ base: { height: '2.25rem' } }),
    'fluid-tab': recipe({
      base: {
        ...transition,
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.25rem',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
        opacity: '1',
        'outline-style': 'none',
      },
      hover: { color: 'var(--foreground)', opacity: '1' },
      selected: {
        color: 'var(--foreground)',
        opacity: '1',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      focus: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--primary)',
        'outline-offset': '1px',
        'box-shadow': 'none',
        opacity: '1',
      },
    }),
    'fluid-tab-default': recipe({ base: { height: '2rem' } }),
    'fluid-tab-small': recipe({ base: { height: '1.75rem' } }),
    'fluid-indicator': recipe({
      base: {
        'transition-property': 'transform',
        'transition-duration': '200ms',
        'transition-timing-function': 'var(--zy-style-ease-smooth)',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'fluid-hover-indicator': recipe({
      base: {
        ...transition,
        opacity: '0',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'none',
      },
    }),
    'fluid-hover-visible': recipe({ parentHover: { opacity: '1' }, parentFocus: { opacity: '1' } }),
    check: recipe({
      base: {
        ...transition,
        height: '1rem',
        width: '1rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'outline-style': 'none',
        'background-color': 'var(--zy-state-input-field)',
      },
      focus,
      checked: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
      },
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'check-field-disabled': recipe({ base: { opacity: '0.5' } }),
    'check-checked-invalid': recipe({ invalid: { 'border-color': 'var(--primary)' } }),
    'check-indicator': recipe({ base: { color: 'currentColor', 'transition-duration': '0s' } }),
    'check-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    range: recipe({ disabled: { opacity: '0.5' } }),
    'range-control': recipe({ base: { height: '1.25rem' } }),
    'range-track': recipe({
      base: {
        height: '0.375rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
      },
    }),
    'range-fill': recipe({ base: { 'background-color': 'var(--primary)' } }),
    'range-thumb': recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'border-radius': '9999px',
        'border-width': '2px',
        'border-style': 'solid',
        'border-color': 'var(--primary)',
        'background-color': 'var(--zy-surface)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
        'outline-style': 'none',
        'transition-property': 'scale',
        'transition-duration': '100ms',
      },
      parentHover: { scale: '1.05' },
      focus: { 'box-shadow': '0 0 0 2px var(--zy-primary-muted)' },
    }),
    'progress-track': recipe({
      base: {
        height: '0.25rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
      },
    }),
    'progress-fill': recipe({
      base: {
        'background-color': 'var(--primary)',
        'transition-property': 'transform',
        'transition-duration': '150ms',
      },
    }),
    'progress-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'progress-value': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
        'font-variant-numeric': 'tabular-nums',
      },
    }),
  };
}

type SettingsAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    | `shortcut-${string}`
    | `send-shortcut-${string}`
    | 'auth-choice'
    | 'code-header-button'
    | 'code-hint'
  >
>;
function classicSettingsControls(): SettingsAppearances {
  const surface = { 'background-color': 'var(--zy-surface-raised)', color: 'var(--foreground)' };
  const highlight = {
    'background-color': 'color-mix(in oklab, var(--primary) 10%, transparent)',
    color: 'var(--primary)',
  };
  const codeHighlight = { 'background-color': 'var(--zy-surface)', color: 'var(--foreground)' };
  return {
    'shortcut-input': recipe({
      base: {
        ...surface,
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-color': 'var(--border)',
      },
      hover: { 'border-color': 'color-mix(in oklab, var(--primary) 50%, transparent)' },
    }),
    'shortcut-recording': recipe({
      base: {
        'border-color': 'var(--primary)',
        'box-shadow': '0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent)',
        color: 'var(--muted-foreground)',
      },
      focus: { 'border-color': 'var(--primary)', color: 'var(--muted-foreground)' },
      hover: { 'border-color': 'var(--primary)' },
    }),
    'send-shortcut-trigger': recipe({
      base: {
        ...surface,
        'border-color': 'var(--border)',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
      },
    }),
    'send-shortcut-popup': recipe({ base: surface }),
    'send-shortcut-option': recipe({
      base: { color: 'var(--foreground)' },
      focus: highlight,
      highlighted: highlight,
    }),
    'auth-choice': recipe({
      base: {
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'var(--border)',
        opacity: '0.6',
        'transition-property': 'background-color, border-color, opacity',
      },
      hover: { opacity: '0.8' },
      selected: {
        'border-color': 'var(--primary)',
        'background-color': 'color-mix(in oklab, var(--primary) 5%, transparent)',
        opacity: '1',
      },
    }),
    'code-header-button': recipe({
      base: {
        height: '1.75rem',
        width: '1.75rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--muted-foreground)',
      },
      hover: codeHighlight,
      selected: codeHighlight,
    }),
    'code-hint': recipe({
      base: {
        'background-color': 'var(--zy-surface-overlay)',
        color: 'var(--foreground)',
        'border-color': 'var(--border)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
  };
}

type ProductAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    | `permission-${string}`
    | `model-${string}`
    | `selector-option-${string}`
    | `market-card${string}`
  >
>;
function classicProductControls(): ProductAppearances {
  return {
    'permission-menu': recipe({ base: { padding: '0.5rem' } }),
    'permission-option': recipe({
      base: {
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline-start': '0.5rem',
        'padding-inline-end': '2rem',
        'padding-block': '0.625rem',
      },
      checked: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'model-menu': recipe({ base: { padding: '0px' } }),
    'selector-option-title': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'selector-option-description': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
    'market-card': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--card)',
        padding: '1rem',
        'box-shadow': 'none',
      },
    }),
    'market-card-header': recipe({ base: { padding: '0px' } }),
    'market-card-content': recipe({ base: { padding: '0px' } }),
    'market-card-footer': recipe({
      base: { 'border-top-width': '0px', 'background-color': 'transparent', padding: '0px' },
    }),
    'market-card-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
      },
    }),
    'market-card-description': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'permission-danger-banner': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.75rem',
      },
    }),
    // Light mode darkens the status hue for text so 14px titles keep AA
    // contrast on the tinted surface; dark tokens are already bright enough.
    'permission-danger-banner-destructive': recipe({
      base: {
        'background-color': 'var(--zy-state-banner-destructive-bg)',
        'border-color': 'var(--zy-state-banner-destructive-border)',
        color: 'var(--zy-state-banner-destructive-text)',
      },
    }),
    'permission-danger-banner-warning': recipe({
      base: {
        'background-color': 'var(--zy-state-banner-warning-bg)',
        'border-color': 'var(--zy-state-banner-warning-border)',
        color: 'var(--zy-state-banner-warning-text)',
      },
    }),
  };
}

export function classicSettingsAndProductAppearances() {
  return {
    ...classicPromptActions(),
    ...classicSupplementaryControls(),
    ...classicSettingsControls(),
    ...classicProductControls(),
  };
}
