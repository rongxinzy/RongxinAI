import { classicChoiceAndTabsAppearances } from './classic-choice-and-tabs';
import { classicConditionalControls } from './classic-conditional-controls';
import { classicControlVariantsAppearances } from './classic-control-modifiers';
import { classicControlsAppearances } from './classic-buttons';
import { classicMiscAndPartsAppearances } from './classic-misc-and-parts';
import { classicOverlaysAndDisplayAppearances } from './classic-extra-overlays';
import { classicPageControls } from './classic-page-controls';
import { classicScenesAppearances } from './classic-scenes';
import { classicSettingsAndProductAppearances } from './classic-settings-and-product';
import { classicSurfacesAppearances } from './classic-surfaces';
import { conversationAppearances } from './conversation';
import type { ComponentAppearance, ComponentAppearances } from './contract';
import { recipe } from './recipe';
import { shellSidebarAppearances } from './shell-sidebar';

function runIndicatorAppearances() {
  return {
    'run-indicator': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1',
        color: 'var(--muted-foreground)',
      },
    }),
    'run-indicator-icon': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'run-indicator-elapsed': recipe({ base: { 'font-variant-numeric': 'tabular-nums' } }),
  };
}

/** Content loading uses the theme's primary color for the entire mark. */
function logoLoadingAppearances() {
  return {
    'logo-loading-mark': recipe({
      base: { width: '8rem', height: 'auto', color: 'var(--primary)' },
    }),
    'logo-loading-dot': recipe({
      base: {
        opacity: '1',
        'animation-name': 'component-motion',
        'animation-duration': '1.2s',
        'animation-timing-function': 'ease-out',
        'animation-iteration-count': 'infinite',
        'animation-direction': 'alternate',
      },
      motionStart: { opacity: '1' },
      motionEnd: { opacity: '0.35' },
    }),
    'logo-loading-label': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'font-size': '0.875rem',
        'line-height': '1.5',
      },
    }),
  };
}

function codingSidebarAppearances() {
  return {
    'coding-session-agent': recipe({
      base: {
        width: 'min(30%, 6.5rem)',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
  };
}

/** Compact transcript activity, inherited by every registered theme. */
function chatToolAppearances() {
  return {
    'chat-tool': recipe({
      base: { 'border-width': '0px', 'background-color': 'transparent', 'box-shadow': 'none' },
    }),
    'chat-tool-trigger': recipe({
      base: {
        'min-height': '2rem',
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
        'text-align': 'left',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      focus: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--ring)',
        'outline-offset': '1px',
      },
      disabled: { opacity: '0.5' },
    }),
    'chat-tool-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--zy-text-muted)' },
    }),
    'chat-tool-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
    'chat-tool-summary': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-family': 'var(--zy-style-font-mono)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'chat-tool-status': recipe({
      base: {
        '--zy-control-icon-size': '0.875rem',
        height: 'auto',
        padding: '0px',
        'border-width': '0px',
        'border-radius': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-xs)',
        'font-variant-numeric': 'tabular-nums',
        color: 'var(--zy-text-muted)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
    }),
    'chat-tool-warning': recipe({ base: { color: 'var(--zy-warning)' } }),
    'chat-tool-error': recipe({ base: { color: 'var(--destructive)' } }),
    'chat-tool-chevron': recipe({
      base: {
        width: '1rem',
        height: '1rem',
        color: 'var(--zy-text-muted)',
        rotate: '0deg',
        'transition-property': 'rotate, color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
    }),
    'chat-tool-chevron-open': recipe({ base: { rotate: '180deg' } }),
    'chat-tool-content': recipe({
      base: {
        'padding-left': '1rem',
        'padding-top': '0.375rem',
        'padding-bottom': '0.5rem',
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-border)',
        color: 'var(--foreground)',
      },
    }),
    'chat-tool-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
    'chat-tool-output-error': recipe({ base: { color: 'var(--destructive)' } }),
  };
}

/** Codex appearance recipes are package data, never imported by React controls. */
export function classicComponentAppearances(): ComponentAppearances {
  const field: ComponentAppearance = recipe({
    base: {
      'border-radius': 'var(--zy-style-radius-lg)',
      'border-width': '1px',
      'border-style': 'solid',
      'border-color': 'var(--input)',
      'background-color': 'var(--zy-state-input-solid)',
      'outline-style': 'none',
      'transition-property': 'color, background-color, border-color, box-shadow',
      'transition-duration': '150ms',
      'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    hover: { 'border-color': 'color-mix(in oklab, var(--ring) 50%, transparent)' },
    pressed: {},
    selected: {},
    expanded: {},
    focus: {
      'border-color': 'var(--ring)',
      'box-shadow': '0 0 0 1px color-mix(in oklab, var(--ring) 40%, transparent)',
    },
    invalid: {
      'border-color': 'var(--zy-state-destructive-border)',
      'box-shadow': '0 0 0 1px color-mix(in oklab, var(--destructive) 40%, transparent)',
    },
    disabled: {
      opacity: '0.5',
      'background-color': `color-mix(in oklab, var(--input) var(--zy-state-input-disabled-tint-percent), transparent)`,
    },
    placeholder: { color: 'var(--muted-foreground)' },
    highlighted: {},
    entering: {},
    exiting: {},
    empty: {},
  });
  return {
    ...runIndicatorAppearances(),
    ...logoLoadingAppearances(),
    ...codingSidebarAppearances(),
    ...classicControlsAppearances(),
    ...classicChoiceAndTabsAppearances(),
    ...classicSurfacesAppearances(),
    ...classicOverlaysAndDisplayAppearances(),
    ...classicMiscAndPartsAppearances(),
    ...classicControlVariantsAppearances(),
    ...classicSettingsAndProductAppearances(),
    ...classicPageControls(),
    ...classicConditionalControls(),
    'input-group': recipe({
      base: {
        ...field.base,
        'background-color': 'var(--zy-state-input-field)',
        height: '2rem',
      },
      hover: field.hover,
      groupFocus: field.focus,
      groupInvalid: field.invalid,
      groupDisabled: { ...field.disabled, 'border-color': 'var(--input)' },
    }),
    'input-embedded': recipe({
      base: {
        'border-radius': '0px',
        'border-width': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'box-shadow': 'none' },
      focus: { 'border-width': '0px', 'box-shadow': 'none' },
      invalid: { 'box-shadow': 'none' },
      disabled: { 'background-color': 'transparent' },
    }),
    'input-group-addon': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
      },
    }),
    'input-group-text': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    input: recipe({
      ...structuredClone(field),
      base: {
        ...field.base,
        height: '2rem',
        'padding-inline': '0.625rem',
        'padding-block': '0.25rem',
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
      },
      wide: { 'font-size': 'var(--zy-component-text-sm)' },
      fileButton: {
        height: '1.5rem',
        'border-width': '0px',
        'background-color': 'transparent',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
    textarea: recipe({
      ...structuredClone(field),
      base: {
        ...field.base,
        'min-height': '4rem',
        'padding-inline': '0.625rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
      },
      wide: { 'font-size': 'var(--zy-component-text-sm)' },
    }),
    ...conversationAppearances(),
    ...classicScenesAppearances(),
    ...chatToolAppearances(),
    ...shellSidebarAppearances(),

    // Quiet Studio composition hooks are supplied by the active theme package.
    'shell-main-panel': recipe({}),
    'shell-brand': recipe({}),
    'shell-brand-mark': recipe({}),
    'shell-kbd': recipe({}),
    'shell-sidebar-time': recipe({}),
    'shell-account-avatar': recipe({}),
    'shell-account-name': recipe({}),
    'shell-account-hint': recipe({}),
    'shell-status-dot': recipe({}),
    'shell-status-dot-warning': recipe({}),
    'home-greeting': recipe({}),
  };
}
