import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type MenuAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `menu-${string}`>
>;
export function classicMenu(dark: boolean): MenuAppearances {
  const highlight = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const danger = {
    'background-color': `color-mix(in oklab, var(--destructive) ${dark ? 20 : 10}%, transparent)`,
    color: 'var(--destructive)',
  };
  return {
    'menu-positioner': recipe({ base: { 'outline-style': 'none' } }),

    'menu-content': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        padding: '0.25rem',
        'box-shadow': 'var(--zy-style-shadow-md)',
        'outline-style': 'none',
      },
    }),
    'menu-motion': recipe({
      base: {
        opacity: '1',
        scale: '1',
        'transition-property': 'opacity, scale',
        'transition-duration': '100ms',
        'transition-timing-function': 'ease-out',
      },
      entering: { opacity: '0', scale: '0.95' },
      exiting: { opacity: '0', scale: '0.95' },
    }),
    'menu-item': recipe({
      base: {
        gap: '0.375rem',
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.25rem 0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      highlighted: highlight,
      disabled: { opacity: '0.5' },
    }),
    'menu-destructive': recipe({
      base: { color: 'var(--destructive)' },
      hover: danger,
      focus: danger,
      highlighted: danger,
    }),
    'menu-sub-trigger': recipe({ expanded: highlight }),
    'menu-sub-content': recipe({ base: { 'box-shadow': 'var(--zy-style-shadow-lg)' } }),
    'menu-check-item': recipe({ base: { 'padding-inline-end': '2rem' } }),
    'menu-label': recipe({
      base: {
        padding: '0.25rem 0.375rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
      },
    }),
    'menu-inset': recipe({ base: { 'padding-inline-start': '1.75rem' } }),
    'menu-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'menu-shortcut': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
  };
}
