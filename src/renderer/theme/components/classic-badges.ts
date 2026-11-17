import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type BadgeAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `badge${string}`>
>;
const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;
export function classicBadges(): BadgeAppearances {
  return {
    badge: recipe({
      base: {
        '--zy-control-icon-size': '0.75rem',
        height: '1.375rem',
        gap: '0.25rem',
        padding: '0 0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-style': 'solid',
        'border-width': '1px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1',
        'font-variant-numeric': 'tabular-nums',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 2px ${mix('ring', 50)}` },
      invalid: {
        'border-color': 'var(--destructive)',
        'box-shadow': `0 0 0 2px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
      disabled: { opacity: '0.5' },
    }),
    'badge-default': recipe({
      base: {
        'background-color': 'var(--zy-primary-muted)',
        'border-color': mix('primary', 24),
        color: 'var(--primary)',
      },
    }),
    'badge-secondary': recipe({
      base: {
        'background-color': 'var(--secondary)',
        'border-color': 'var(--zy-border)',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-destructive': recipe({
      base: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-tint-percent), transparent)`,
        'border-color': mix('destructive', 24),
        color: 'var(--destructive)',
      },
      focus: {
        'box-shadow': `0 0 0 2px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
    }),
    'badge-outline': recipe({
      base: {
        'border-color': 'var(--zy-input-border)',
        'background-color': 'transparent',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-ghost': recipe({
      hover: {
        'background-color': 'var(--zy-state-muted-hover)',
        color: 'var(--muted-foreground)',
      },
    }),
    'badge-link': recipe({
      base: { color: 'var(--primary)', 'text-underline-offset': '4px' },
      hover: { 'text-decoration': 'underline' },
    }),
    'badge-default-link': recipe({ hover: { 'background-color': mix('primary', 80) } }),
    'badge-secondary-link': recipe({ hover: { 'background-color': mix('secondary', 80) } }),
    'badge-destructive-link': recipe({ hover: { 'background-color': mix('destructive', 20) } }),
    'badge-outline-link': recipe({
      hover: { 'background-color': 'var(--muted)', color: 'var(--muted-foreground)' },
    }),
  };
}
