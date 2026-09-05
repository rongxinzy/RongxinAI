import { recipe } from './recipe';
import type { AppearanceStyle, ComponentAppearances } from './contract';
type ExtraAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    `sheet-${string}` | `tooltip-${string}` | `hover-card-${string}` | `confirm-${string}`
  >
>;
export function classicExtraOverlays(): ExtraAppearances {
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
