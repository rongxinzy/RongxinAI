import { recipe } from './recipe';

function classicMisc() {
  return {
    label: recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'label-disabled': recipe({ base: { opacity: '0.5' } }),
    'breadcrumb-list': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    'breadcrumb-link': recipe({
      base: { 'transition-property': 'color', 'transition-duration': '150ms' },
      hover: { color: 'var(--foreground)' },
    }),
    'breadcrumb-page': recipe({
      base: { 'font-weight': 'var(--zy-component-font-weight-normal)', color: 'var(--foreground)' },
    }),
    'breadcrumb-separator': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'breadcrumb-ellipsis': recipe({ base: { width: '1.25rem', height: '1.25rem' } }),
    'breadcrumb-ellipsis-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'scroll-viewport': recipe({
      base: {
        'border-radius': 'inherit',
        'transition-property': 'color, box-shadow',
        'transition-duration': '150ms',
        'outline-style': 'none',
      },
      focus: {
        'box-shadow': '0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent)',
        'outline-style': 'solid',
        'outline-width': '1px',
      },
    }),
    'scroll-bar': recipe({
      base: {
        padding: '1px',
        'transition-property': 'color, background-color, border-color',
        'transition-duration': '150ms',
        'border-style': 'solid',
      },
    }),
    'scroll-horizontal': recipe({
      base: { height: '0.625rem', 'border-top-width': '1px', 'border-top-color': 'transparent' },
    }),
    'scroll-vertical': recipe({
      base: { width: '0.625rem', 'border-left-width': '1px', 'border-left-color': 'transparent' },
    }),
    'scroll-thumb': recipe({
      base: { 'border-radius': '9999px', 'background-color': 'var(--border)' },
    }),
    avatar: recipe({ base: { width: '2rem', height: '2rem', 'border-radius': '9999px' } }),
    'avatar-small': recipe({ base: { width: '1.5rem', height: '1.5rem' } }),
    'avatar-large': recipe({ base: { width: '2.5rem', height: '2.5rem' } }),
    'avatar-outline': recipe({
      base: {
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'avatar-image': recipe({ base: { 'border-radius': '9999px' } }),
    'avatar-fallback': recipe({
      base: {
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
        color: 'var(--muted-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'avatar-small-fallback': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'avatar-badge': recipe({
      base: {
        'border-radius': '9999px',
        'background-color': 'var(--primary)',
        color: 'var(--primary-foreground)',
        'box-shadow': '0 0 0 2px var(--background)',
      },
    }),
    'avatar-badge-sm': recipe({ base: { width: '0.5rem', height: '0.5rem' } }),
    'avatar-badge-default': recipe({ base: { width: '0.625rem', height: '0.625rem' } }),
    'avatar-badge-lg': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'avatar-badge-icon': recipe({ base: { width: '0.5rem', height: '0.5rem' } }),
    'avatar-group-ring': recipe({ base: { 'box-shadow': '0 0 0 2px var(--background)' } }),
    'avatar-count': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted)',
        color: 'var(--muted-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
        'box-shadow': '0 0 0 2px var(--background)',
      },
    }),
    'avatar-count-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'avatar-count-lg': recipe({ base: { width: '2.5rem', height: '2.5rem' } }),
    'avatar-count-icon-lg': recipe({ base: { width: '1.25rem', height: '1.25rem' } }),
    'avatar-count-sm': recipe({ base: { width: '1.5rem', height: '1.5rem' } }),
    'avatar-count-icon-sm': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'avatar-outline-blend': recipe({ base: { 'mix-blend-mode': 'var(--zy-state-avatar-blend)' } }),
    'avatar-badge-blend': recipe({ base: { 'background-blend-mode': 'color' } }),
    spinner: recipe({
      base: {
        width: '1rem',
        height: '1rem',
        'animation-name': 'component-motion',
        'animation-duration': '1s',
        'animation-timing-function': 'linear',
        'animation-iteration-count': 'infinite',
      },
      motionStart: { rotate: '0deg' },
      motionEnd: { rotate: '360deg' },
    }),
  };
}

/** Miniature interface drawings consume the previewed package's scoped tokens. */
function classicAppearancePreview() {
  return {
    'appearance-mode-tab': recipe({ base: { opacity: '1' } }),
    'appearance-preview-frame': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-background)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
      },
    }),
    'appearance-preview-sidebar': recipe({
      base: {
        'background-color': 'var(--sidebar)',
        padding: '0.5rem',
      },
    }),
    'appearance-preview-main': recipe({ base: { padding: '0.75rem' } }),
    'appearance-preview-line': recipe({
      base: {
        height: '0.25rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'background-color': 'var(--zy-text-primary)',
        opacity: '0.55',
      },
    }),
    'appearance-preview-muted': recipe({
      base: {
        height: '0.25rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'background-color': 'var(--zy-text-secondary)',
        opacity: '0.3',
      },
    }),
    'appearance-preview-selection': recipe({
      base: {
        height: '0.75rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'background-color': 'var(--zy-surface)',
      },
    }),
    'appearance-preview-message': recipe({
      base: {
        height: '1.25rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'background-color': 'var(--zy-surface-raised)',
      },
    }),
    'appearance-preview-composer': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
      },
    }),
    'appearance-preview-send': recipe({
      base: {
        width: '0.875rem',
        height: '0.875rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'background-color': 'var(--zy-primary)',
      },
    }),
    'appearance-preview-check': recipe({ base: { width: '1rem', height: '1rem' } }),
  };
}

function classicSharedCompositions() {
  const icon = {
    padding: '0px',
    'border-radius': 'calc(var(--radius) - 3px)',
    width: '1.5rem',
    height: '1.5rem',
  };
  return {
    'group-spacing-addon': recipe({ base: { 'padding-block': '0.375rem' } }),
    'group-spacing-inline-start': recipe({ base: { 'padding-left': '0.5rem' } }),
    'group-spacing-inline-end': recipe({ base: { 'padding-right': '0.5rem' } }),
    'group-spacing-block-start': recipe({
      base: { 'padding-inline': '0.625rem', 'padding-top': '0.5rem' },
    }),
    'group-spacing-block-end': recipe({
      base: { 'padding-inline': '0.625rem', 'padding-bottom': '0.5rem' },
    }),
    'group-spacing-start-border': recipe({ base: { 'padding-bottom': '0.5rem' } }),
    'group-spacing-end-border': recipe({ base: { 'padding-top': '0.5rem' } }),
    'group-spacing-input-top': recipe({ base: { 'padding-top': '0.75rem' } }),
    'group-spacing-input-bottom': recipe({ base: { 'padding-bottom': '0.75rem' } }),
    'group-spacing-input-right': recipe({ base: { 'padding-right': '0.375rem' } }),
    'group-spacing-input-left': recipe({ base: { 'padding-left': '0.375rem' } }),
    'control-tooltip-kbd': recipe({ base: { 'border-radius': 'var(--zy-style-radius-sm)' } }),
    'control-command-search-icon': recipe({ base: { opacity: '0.5' } }),
    'control-card-first-image': recipe({
      base: {
        'border-top-left-radius': 'var(--zy-style-radius-xl)',
        'border-top-right-radius': 'var(--zy-style-radius-xl)',
      },
    }),
    'control-card-last-image': recipe({
      base: {
        'border-bottom-left-radius': 'var(--zy-style-radius-xl)',
        'border-bottom-right-radius': 'var(--zy-style-radius-xl)',
      },
    }),
    'control-dialog-link': recipe({
      base: { 'text-decoration': 'underline', 'text-underline-offset': '3px' },
      hover: { color: 'var(--foreground)' },
    }),
    'joined-control': recipe({ base: { 'border-radius': 'var(--zy-style-radius-lg)' } }),
    'joined-horizontal-start': recipe({
      base: {
        'border-top-right-radius': '0px',
        'border-bottom-right-radius': '0px',
      },
    }),
    'joined-horizontal-end': recipe({
      base: {
        'border-top-left-radius': '0px',
        'border-bottom-left-radius': '0px',
        'border-left-width': '0px',
      },
    }),
    'joined-vertical-start': recipe({
      base: {
        'border-bottom-left-radius': '0px',
        'border-bottom-right-radius': '0px',
      },
    }),
    'joined-vertical-end': recipe({
      base: {
        'border-top-left-radius': '0px',
        'border-top-right-radius': '0px',
        'border-top-width': '0px',
      },
    }),
    'joined-text': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--muted)',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'joined-separator': recipe({ base: { 'background-color': 'var(--input)' } }),
    'input-group-button': recipe({
      base: {
        gap: '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'box-shadow': 'none',
      },
    }),
    'input-group-button-xs': recipe({
      base: {
        height: '1.5rem',
        gap: '0.25rem',
        'border-radius': 'calc(var(--radius) - 3px)',
        'padding-inline': '0.375rem',
      },
    }),
    'input-group-button-icon-xs': recipe({ base: icon }),
    'input-group-button-icon-sm': recipe({
      base: { padding: '0px', width: '2rem', height: '2rem' },
    }),
    'input-group-addon-disabled': recipe({ base: { opacity: '0.5' } }),
    'input-group-addon-kbd': recipe({ base: { 'border-radius': 'calc(var(--radius) - 5px)' } }),
  };
}

function classicCompositionControls() {
  const searchGroup = recipe({
    base: { 'background-color': 'transparent', 'box-shadow': 'none' },
    groupFocus: { 'box-shadow': 'none' },
    groupInvalid: { 'box-shadow': 'none' },
  });
  return {
    'expert-search-group': structuredClone(searchGroup),
    'skill-search-group': structuredClone(searchGroup),
    'input-submit': recipe({
      base: {
        'border-radius': '9999px',
        'transition-property': 'background-color, translate',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
      pressed: { translate: '0 1px' },
    }),
    'local-compact-action': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.75rem',
        'transition-property': 'background-color, border-color',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
  };
}

/** Page-specific compositions, extracted without moving event handlers or application state. */
function classicPartControls() {
  return {
    'part-coding-agent-manager-dialog-header-1': recipe({
      base: {
        'border-bottom-width': '0px',
        'padding-inline': '1.5rem',
        'padding-block': '1.25rem',
        'padding-right': '3.5rem',
      },
    }),
    'part-coding-agent-manager-dialog-footer-1': recipe({
      base: {
        'border-top-width': '0px',
        'border-radius': '0px',
        'background-color': 'var(--zy-background)',
        'padding-inline': '1.5rem',
        'padding-block': '1rem',
      },
    }),
    'part-session-expert-picker-command-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-surface)',
      },
    }),
    'part-expert-detail-dialog-dialog-header-1': recipe({
      base: {
        gap: '0.75rem',
        'border-bottom-width': '1px',
        'border-color': 'var(--zy-border)',
        'padding-inline': '1.5rem',
        'padding-block': '1rem',
      },
    }),
    'part-expert-detail-dialog-dialog-title-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'part-expert-detail-dialog-dialog-footer-1': recipe({
      base: { 'border-radius': '0px', 'padding-inline': '1.5rem', 'padding-block': '1rem' },
    }),
    'part-model-context-settings-modal-input-group-input-1': recipe({
      base: {
        height: '1.75rem',
        width: '2.5rem',
        'padding-left': '0.25rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
      },
    }),
    'part-model-context-settings-modal-input-group-text-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
        color: 'var(--zy-foreground)',
      },
    }),
    'part-marketplace-panel-input-group-input-1': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'part-marketplace-panel-select-value-1': recipe({
      base: {
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-foreground)',
      },
    }),
    'part-run-session-modal-dialog-header-1': recipe({
      base: {
        'padding-inline': '1.25rem',
        'padding-block': '0.75rem',
        'border-bottom-width': '1px',
        'border-color': 'var(--zy-border)',
      },
    }),
    'part-run-session-modal-dialog-title-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'part-skills-popover-command-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-surface)',
      },
    }),
  };
}

export function classicMiscAndPartsAppearances() {
  return {
    ...classicMisc(),
    ...classicAppearancePreview(),
    ...classicSharedCompositions(),
    ...classicCompositionControls(),
    ...classicPartControls(),
  };
}
