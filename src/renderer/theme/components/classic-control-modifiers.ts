import { recipe } from './recipe';
export function classicControlModifiers() {
  return {
    'action-compact': recipe({
      base: {
        height: 'auto',
        padding: '0.25rem 0.625rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'action-icon-muted': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
      },
      hover: { color: 'var(--foreground)', 'background-color': 'var(--zy-surface)' },
    }),
    'action-inline-underlined': recipe({
      base: {
        height: 'auto',
        padding: '0px',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'text-decoration': 'underline',
        'text-underline-offset': '2px',
      },
    }),
    'control-inline-edit': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        padding: '0px',
        'border-width': '0px',
        'border-bottom-width': '1px',
        'border-color': 'var(--primary)',
        'border-radius': '0px',
        'background-color': 'transparent',
      },
    }),
    'control-small-text': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': 'var(--zy-component-text-sm--line-height)',
      },
    }),
    'control-muted': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'action-inline-link': recipe({
      base: {
        height: 'auto',
        padding: '0px',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        color: 'var(--primary)',
      },
      hover: { 'text-decoration': 'underline' },
    }),
    'action-faint': recipe({
      base: { color: 'var(--foreground)', opacity: '0.34' },
      hover: { opacity: '0.5' },
    }),
    'action-muted': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--foreground)' },
    }),
    'action-row-large': recipe({
      base: {
        padding: '0.75rem 1.25rem',
        height: 'auto',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'control-compact-field': recipe({
      base: {
        height: '2rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'action-row': recipe({
      base: {
        height: '2.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'action-muted-accent': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--primary)' },
    }),
    'action-compact-danger': recipe({
      base: {
        height: 'auto',
        padding: '0.25rem 0.625rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        'border-color': 'color-mix(in oklab, var(--destructive) 30%, transparent)',
        color: 'var(--destructive)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--destructive) 10%, transparent)' },
    }),
    'action-inline-danger': recipe({
      base: {
        height: 'auto',
        padding: '0px',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        color: 'var(--muted-foreground)',
      },
      hover: { color: 'var(--destructive)' },
    }),
    'action-overlay-compact': recipe({
      base: {
        padding: '0.25rem 0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'action-small': recipe({
      base: {
        height: '1.75rem',
        gap: '0.25rem',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'control-transparent': recipe({ base: { 'background-color': 'transparent' } }),
    'control-card-surface': recipe({ base: { 'background-color': 'var(--card)' } }),
    'action-icon-small-muted': recipe({
      base: { height: '1.75rem', width: '1.75rem', color: 'var(--muted-foreground)' },
      hover: { color: 'var(--foreground)' },
    }),
    'action-window': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'color-mix(in oklab, var(--foreground) 60%, transparent)',
      },
      hover: { color: 'var(--foreground)', 'background-color': 'var(--zy-surface-raised)' },
    }),
  };
}
