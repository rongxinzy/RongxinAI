import { recipe } from './recipe';
export function classicDisplay() {
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
