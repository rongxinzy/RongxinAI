import { recipe } from './recipe';
import type { AppearanceStyle, ComponentAppearances } from './contract';

type ExtraAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    `sheet-${string}` | `tooltip-${string}` | `hover-card-${string}` | `confirm-${string}`
  >
>;
function classicExtraOverlays(): ExtraAppearances {
  const small = { 'font-size': 'var(--zy-component-text-sm)' };
  const popup: AppearanceStyle = {
    ...small,
    'border-radius': 'var(--zy-style-radius-lg)',
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
    'background-color': 'var(--popover)',
    color: 'var(--popover-foreground)',
    'box-shadow': 'var(--zy-style-shadow-md)',
    'outline-style': 'none',
    opacity: '1',
    scale: '1',
    'transition-property': 'opacity, scale',
    'transition-duration': '100ms',
    'transition-timing-function': 'ease-out',
  };
  const hidden = { opacity: '0', scale: '0.95' };
  const title = {
    'font-size': 'var(--zy-component-text-base)',
    'font-weight': 'var(--zy-component-font-weight-medium)',
    color: 'var(--foreground)',
  };
  const confirm = { height: '2rem', 'padding-inline': '0.75rem', 'box-shadow': 'none' };
  const danger = {
    'background-color': 'var(--zy-style-destructive-confirm)',
    'border-color': 'var(--zy-style-destructive-confirm)',
    color: 'var(--zy-destructive-foreground)',
  };
  const dangerHover = {
    'background-color':
      'color-mix(in srgb, var(--zy-style-destructive-confirm) 88%, var(--zy-component-palette-black))',
    'border-color':
      'color-mix(in srgb, var(--zy-style-destructive-confirm) 88%, var(--zy-component-palette-black))',
    color: 'var(--zy-destructive-foreground)',
  };
  return {
    'sheet-content': recipe({
      base: {
        ...small,
        gap: '1rem',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
        'border-color': 'var(--border)',
        opacity: '1',
        translate: '0 0',
        'transition-property': 'opacity, translate',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-in-out',
      },
      entering: { opacity: '0' },
      exiting: { opacity: '0' },
    }),
    'sheet-top': recipe({
      entering: { translate: '0 -2.5rem' },
      exiting: { translate: '0 -2.5rem' },
    }),
    'sheet-bottom': recipe({
      entering: { translate: '0 2.5rem' },
      exiting: { translate: '0 2.5rem' },
    }),
    'sheet-left': recipe({
      entering: { translate: '-2.5rem 0' },
      exiting: { translate: '-2.5rem 0' },
    }),
    'sheet-right': recipe({
      entering: { translate: '2.5rem 0' },
      exiting: { translate: '2.5rem 0' },
    }),
    'sheet-overlay': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 10%, transparent)',
        opacity: '1',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
      },
      entering: { opacity: '0' },
      exiting: { opacity: '0' },
    }),
    'sheet-title': recipe({ base: title }),
    'sheet-description': recipe({ base: { ...small, color: 'var(--muted-foreground)' } }),
    'sheet-header': recipe({ base: { padding: '1rem' } }),
    'sheet-footer': recipe({ base: { padding: '1rem' } }),
    'tooltip-content': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--foreground)',
        color: 'var(--background)',
        padding: '0.375rem 0.75rem',
        gap: '0.375rem',
        'font-size': 'var(--zy-component-text-xs)',
        opacity: '1',
        scale: '1',
        'transition-property': 'opacity, scale',
        'transition-duration': '150ms',
      },
      entering: hidden,
      exiting: hidden,
    }),
    'tooltip-arrow': recipe({
      base: {
        'border-radius': '2px',
        'background-color': 'var(--foreground)',
        fill: 'var(--foreground)',
      },
    }),
    'hover-card-content': recipe({
      base: { ...popup, padding: '0.625rem' },
      entering: hidden,
      exiting: hidden,
    }),
    'confirm-dialog': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-2xl)',
        padding: '0px',
        'box-shadow': 'var(--zy-style-shadow-2xl)',
      },
    }),
    'confirm-title': recipe({
      base: { ...title, 'font-weight': 'var(--zy-component-font-weight-semibold)' },
    }),
    'confirm-description': recipe({
      base: { ...small, 'line-height': '1.5rem', color: 'var(--muted-foreground)' },
    }),
    'confirm-button': recipe({ base: { ...confirm, ...danger }, hover: dangerHover }),
    'confirm-cancel': recipe({
      base: { ...confirm, 'border-width': '0px', color: 'var(--muted-foreground)' },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--foreground)' },
    }),
    'confirm-secondary': recipe({
      base: { ...confirm, 'border-width': '0px', color: 'var(--destructive)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
  };
}

function classicEditorControls() {
  return {
    'editor-search-nav-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'editor-search-close-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'editor-search-custom': recipe({
      base: {
        gap: '4px',
        padding: '5px 10px',
        'border-bottom-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface-raised)',
        'font-family': 'var(--zy-style-font-mono)',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'editor-search-input': recipe({
      base: {
        height: '26px',
        padding: '0 8px',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--zy-foreground)',
        'font-size': 'var(--zy-component-text-xs)',
        'outline-style': 'none',
      },
      focused: { 'border-color': 'var(--zy-primary)' },
    }),
    'editor-search-count': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--zy-text-secondary)',
        'font-variant-numeric': 'tabular-nums',
      },
    }),
    'editor-search-count--none': recipe({ base: { color: 'var(--zy-component-editor-error)' } }),
    'editor-search-nav-btn': recipe({
      base: {
        width: '26px',
        height: '26px',
        padding: '0',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface-raised)',
        color: 'var(--zy-text-secondary)',
        'transition-property': 'background-color, color',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease',
      },
      hover: { 'background-color': 'var(--zy-surface-tertiary)', color: 'var(--zy-foreground)' },
    }),
    'editor-search-sep': recipe({
      base: { width: '1px', height: '16px', 'background-color': 'var(--zy-border)' },
    }),
    'editor-search-opt': recipe({
      base: {
        gap: '4px',
        height: '26px',
        padding: '0 6px',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--zy-text-secondary)',
        'transition-property': 'background-color, border-color, color',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--zy-foreground)' },
    }),
    'editor-search-opt-checkbox': recipe({ base: { 'accent-color': 'var(--zy-primary)' } }),
    'editor-search-close-btn': recipe({
      base: {
        width: '26px',
        height: '26px',
        padding: '0',
        'border-radius': 'var(--zy-style-radius-sm)',
        'border-width': '0px',
        'border-style': 'none',
        'background-color': 'transparent',
        color: 'var(--zy-text-secondary)',
        'transition-property': 'background-color, color',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--zy-foreground)' },
    }),
  };
}

type CodingDiffAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `coding-diff${string}`>
>;

function classicCodingDiff(): CodingDiffAppearances {
  const gutter = {
    'font-variant-numeric': 'tabular-nums',
    'text-align': 'right',
    opacity: '0.6',
    padding: '0 0.5rem',
  };

  return {
    'coding-diff': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'coding-diff-line-added': recipe({
      base: {
        'border-left-width': '4px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-component-diff-added)',
        'background-color': 'var(--zy-component-diff-added-background)',
      },
    }),
    'coding-diff-line-removed': recipe({
      base: {
        'border-left-width': '4px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-component-diff-removed)',
        'background-color': 'var(--zy-component-diff-removed-background)',
      },
    }),
    'coding-diff-line-context': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'coding-diff-line-header': recipe({
      base: {
        'background-color': 'color-mix(in oklab, var(--muted) 40%, transparent)',
        color: 'var(--muted-foreground)',
      },
    }),
    'coding-diff-gutter-added': recipe({
      base: { ...gutter, color: 'var(--zy-component-diff-added)' },
    }),
    'coding-diff-gutter-removed': recipe({
      base: { ...gutter, color: 'var(--zy-component-diff-removed)' },
    }),
    'coding-diff-gutter-context': recipe({ base: { ...gutter, color: 'var(--muted-foreground)' } }),
    'coding-diff-gutter-header': recipe({ base: { ...gutter, color: 'var(--muted-foreground)' } }),
    'coding-diff-prefix': recipe({ base: { 'text-align': 'center', padding: '0 0.25rem' } }),
    'coding-diff-code': recipe({ base: { padding: '0 0.5rem', color: 'var(--foreground)' } }),
  };
}

function classicDisplay() {
  return {
    table: recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'table-row': recipe({
      base: {
        'border-bottom-width': '1px',
        'border-style': 'solid',
        'transition-property': 'color, background-color, border-color',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)' },
      selected: { 'background-color': 'var(--muted)' },
    }),
    'table-header-row': recipe({ base: { 'border-bottom-width': '1px', 'border-style': 'solid' } }),
    'table-body-last': recipe({ base: { 'border-width': '0px' } }),
    'table-footer': recipe({
      base: {
        'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)',
        'border-top-width': '1px',
        'border-style': 'solid',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'table-footer-last': recipe({ base: { 'border-bottom-width': '0px' } }),
    'table-expanded': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)' },
    }),
    'table-head': recipe({
      base: {
        height: '2.5rem',
        'padding-inline': '0.5rem',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
    'table-cell': recipe({ base: { padding: '0.5rem' } }),
    'table-check': recipe({ base: { 'padding-right': '0px' } }),
    'table-caption': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    alert: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'padding-inline': '0.625rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'background-color': 'var(--card)',
        color: 'var(--card-foreground)',
      },
    }),
    'alert-action-space': recipe({ base: { 'padding-right': '4.5rem' } }),
    'alert-title': recipe({ base: { 'font-weight': 'var(--zy-component-font-weight-medium)' } }),
    'alert-description': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    'alert-destructive': recipe({ base: { color: 'var(--destructive)' } }),
    'alert-destructive-description': recipe({
      base: { color: 'color-mix(in oklab, var(--destructive) 90%, transparent)' },
    }),
    'alert-icon': recipe({ base: { color: 'currentColor' } }),
    'alert-icon-size': recipe({ base: { width: '1rem', height: '1rem' } }),
    'alert-link': recipe({
      base: { 'text-decoration': 'underline', 'text-underline-offset': '3px' },
      hover: { color: 'var(--foreground)' },
    }),
    skeleton: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--muted)',
        'animation-name': 'component-motion',
        'animation-duration': '1s',
        'animation-timing-function': 'cubic-bezier(0.4, 0, 0.6, 1)',
        'animation-iteration-count': 'infinite',
        'animation-direction': 'alternate',
      },
      motionStart: { opacity: '1' },
      motionEnd: { opacity: '0.5' },
    }),
    separator: recipe({ base: { 'background-color': 'var(--border)' } }),
    'separator-horizontal': recipe({ base: { height: '1px' } }),
    'separator-vertical': recipe({ base: { width: '1px' } }),
    empty: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'border-style': 'dashed',
        padding: '1.5rem',
      },
    }),
    'empty-media': recipe({ base: { 'background-color': 'transparent' } }),
    'empty-media-icon': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--muted)',
        color: 'var(--foreground)',
      },
    }),
    'empty-media-svg': recipe({ base: { width: '1rem', height: '1rem' } }),
    'empty-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'letter-spacing': '-0.025em',
      },
    }),
    'empty-description': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.625',
        color: 'var(--muted-foreground)',
      },
    }),
    'empty-content': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'empty-link': recipe({
      base: { 'text-decoration': 'underline', 'text-underline-offset': '4px' },
      hover: { color: 'var(--primary)' },
    }),
  };
}

export function classicOverlaysAndDisplayAppearances() {
  return {
    ...classicExtraOverlays(),
    ...classicEditorControls(),
    ...classicCodingDiff(),
    ...classicDisplay(),
  };
}
