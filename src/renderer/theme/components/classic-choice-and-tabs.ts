import { recipe } from './recipe';

function classicChoiceControls() {
  const focus = {
    'border-color': 'var(--ring)',
    'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
  };
  const invalid = {
    'border-color': 'var(--zy-state-destructive-border)',
    'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
  };
  return {
    radio: recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'outline-style': 'none',
        'background-color': 'var(--zy-state-input-field)',
      },
      focus,
      invalid,
      disabled: { opacity: '0.5' },
      checked: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
      },
    }),
    'radio-checked-invalid': recipe({ invalid: { 'border-color': 'var(--primary)' } }),
    'radio-indicator': recipe({ base: { width: '1rem', height: '1rem' } }),
    'radio-dot': recipe({
      base: {
        width: '0.5rem',
        height: '0.5rem',
        'border-radius': '9999px',
        'background-color': 'var(--primary-foreground)',
      },
    }),
    toggle: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'background-color': 'transparent',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
      selected: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
      focus,
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'toggle-on': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'toggle-outline': recipe({
      base: { 'border-width': '1px', 'border-style': 'solid', 'border-color': 'var(--input)' },
    }),
    'toggle-default': recipe({
      base: { height: '2rem', 'min-width': '2rem', 'padding-inline': '0.625rem' },
    }),
    'toggle-small': recipe({
      base: {
        height: '1.75rem',
        'min-width': '1.75rem',
        'padding-inline': '0.625rem',
        'border-radius': 'var(--zy-style-radius-md)',
      },
    }),
    'toggle-large': recipe({
      base: { height: '2.25rem', 'min-width': '2.25rem', 'padding-inline': '0.625rem' },
    }),
    'toggle-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'toggle-small-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'toggle-leading': recipe({ base: { 'padding-left': '0.5rem' } }),
    'toggle-trailing': recipe({ base: { 'padding-right': '0.5rem' } }),
    'toggle-small-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'toggle-small-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'toggle-group': recipe({ base: { 'border-radius': 'var(--zy-style-radius-lg)' } }),
    'toggle-group-small': recipe({ base: { 'border-radius': 'var(--zy-style-radius-md)' } }),
    'toggle-joined': recipe({ base: { 'border-radius': '0px', 'padding-inline': '0.5rem' } }),
    'toggle-joined-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'toggle-joined-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'toggle-joined-horizontal-outline': recipe({ base: { 'border-left-width': '0px' } }),
    'toggle-joined-horizontal-first-outline': recipe({ base: { 'border-left-width': '1px' } }),
    'toggle-joined-horizontal-first': recipe({
      base: {
        'border-top-left-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-left-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-horizontal-last': recipe({
      base: {
        'border-top-right-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-vertical-outline': recipe({ base: { 'border-top-width': '0px' } }),
    'toggle-joined-vertical-first-outline': recipe({ base: { 'border-top-width': '1px' } }),
    'toggle-joined-vertical-first': recipe({
      base: {
        'border-top-left-radius': 'var(--zy-style-radius-lg)',
        'border-top-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'toggle-joined-vertical-last': recipe({
      base: {
        'border-bottom-left-radius': 'var(--zy-style-radius-lg)',
        'border-bottom-right-radius': 'var(--zy-style-radius-lg)',
      },
    }),
  };
}

/** Native controls keep their DOM and handlers while sharing package-owned state styles. */
function classicNativeControls() {
  const transition = {
    'transition-property': 'color, background-color, border-color, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  const rounded = { 'border-radius': 'var(--zy-style-radius-md)' };
  const focus = { 'outline-style': 'none', 'box-shadow': '0 0 0 2px var(--ring)' };
  const fieldRing = { 'box-shadow': '0 0 0 1px color-mix(in oklab, var(--ring) 40%, transparent)' };
  return {
    'native-slide': recipe({ base: { ...rounded, ...transition, 'outline-style': 'none' }, focus }),
    'native-slide-selected': recipe({
      base: { 'background-color': 'var(--accent)', color: 'var(--accent-foreground)' },
    }),
    'native-slide-idle': recipe({ hover: { 'background-color': 'var(--muted)' } }),
    'native-activity-button': recipe({
      base: {
        ...rounded,
        ...transition,
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'color-mix(in oklab, var(--muted) 40%, transparent)',
        'font-family': 'var(--zy-style-font-mono)',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'var(--muted)', color: 'var(--foreground)' },
    }),
    'native-workspace-action': recipe({
      base: {
        ...rounded,
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'color-mix(in srgb, var(--zy-text-primary) 4%, transparent)' },
    }),
    'native-field': recipe({
      base: {
        ...transition,
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'background-color': 'var(--background)',
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--foreground)',
        'outline-style': 'none',
      },
      hover: fieldRing,
      focus: { ...fieldRing, 'border-color': 'var(--ring)' },
    }),
    'native-rename-field': recipe({
      base: { 'font-weight': 'var(--zy-component-font-weight-medium)' },
    }),
    'native-audit-link': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-sm)',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
        'text-underline-offset': '4px',
      },
      hover: { color: 'var(--foreground)', 'text-decoration': 'underline' },
      focus,
    }),
    'native-audit-row': recipe({
      base: { ...rounded, ...transition },
      hover: { 'background-color': 'var(--muted)' },
      focus: {
        'outline-style': 'none',
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
      },
      pressed: { translate: '0 1px' },
    }),
    'native-sidebar-rail': recipe({
      base: {
        'transition-property': 'all',
        'transition-duration': '150ms',
        'transition-timing-function': 'linear',
      },
    }),
    'native-sidebar-rail-line': recipe({ hover: { 'background-color': 'var(--sidebar-border)' } }),
    'native-sidebar-offcanvas': recipe({ hover: { 'background-color': 'var(--sidebar)' } }),
  };
}

/** Product state hooks share behavior with Button/Badge, but own their appearance. */
function classicLocalControls() {
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

function classicTabs() {
  const clear = { 'background-color': 'transparent', 'box-shadow': 'none' };
  const transition = {
    'transition-property': 'color, background-color, border-color, box-shadow',
    'transition-duration': '150ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  return {
    'tabs-list': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '3px',
        color: 'var(--muted-foreground)',
      },
    }),
    'tabs-list-horizontal': recipe({ base: { height: '2rem' } }),
    'tabs-list-default': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'tabs-list-line': recipe({
      base: { 'border-radius': '0px', 'background-color': 'transparent' },
    }),
    'tabs-trigger': recipe({
      base: {
        height: 'calc(100% - 1px)',
        ...transition,
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'padding-inline': '0.375rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-state-muted-tab-text)',
      },
      hover: { color: 'var(--foreground)' },
      focus: {
        'border-color': 'var(--ring)',
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
        'outline-width': '1px',
        'outline-style': 'solid',
        'outline-color': 'var(--ring)',
      },
      selected: {
        'background-color': 'var(--zy-state-input-field)',
        color: 'var(--foreground)',
        'border-color': 'var(--zy-state-input-border)',
      },
      disabled: { opacity: '0.5' },
    }),
    'tabs-default-trigger': recipe({ selected: { 'box-shadow': 'var(--zy-style-shadow-sm)' } }),
    'tabs-line-trigger': recipe({
      base: { 'background-color': 'transparent' },
      selected: { ...clear, 'border-color': 'var(--zy-state-tab-selected-border)' },
    }),
    'tabs-trigger-leading': recipe({ base: { 'padding-left': '0.25rem' } }),
    'tabs-trigger-trailing': recipe({ base: { 'padding-right': '0.25rem' } }),
    'tabs-trigger-icon': recipe({ base: { height: '1rem', width: '1rem' } }),
    'tabs-trigger-indicator': recipe({
      base: {
        'background-color': 'var(--foreground)',
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    }),
    'tabs-line-indicator': recipe({ selected: { opacity: '1' } }),
    'tabs-horizontal-indicator': recipe({ base: { height: '0.125rem' } }),
    'tabs-vertical-indicator': recipe({ base: { width: '0.125rem' } }),
    'tabs-content': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', 'outline-style': 'none' },
    }),
    // Preserve measured list height: the original horizontal rule won over h-9.
    'page-tabs-list': recipe({ base: { height: '2rem', padding: '0px' } }),
    'page-tabs-trigger': recipe({
      base: {
        ...clear,
        height: '2.25rem',
        'border-radius': '0px',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { color: 'var(--foreground)' },
      selected: { ...clear, color: 'var(--foreground)' },
    }),
    'page-tabs-indicator': recipe({
      base: {
        height: '0.125rem',
        'border-radius': '9999px',
        'background-color': 'var(--foreground)',
      },
    }),
  };
}

export function classicChoiceAndTabsAppearances() {
  return {
    ...classicChoiceControls(),
    ...classicNativeControls(),
    ...classicLocalControls(),
    ...classicTabs(),
  };
}
