import { recipe } from './recipe';

export function classicSharedCompositions() {
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
