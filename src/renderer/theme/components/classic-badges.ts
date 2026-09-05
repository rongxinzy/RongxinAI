import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type BadgeAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `badge${string}`>
>;
const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;
export function classicBadges(dark: boolean): BadgeAppearances {
  return {
    badge: recipe({
      base: {
        '--zy-control-icon-size': '0.75rem',
        height: '1.25rem',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        'border-radius': '9999px',
        'border-style': 'solid',
        'border-width': '1px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 3px ${mix('ring', 50)}` },
      invalid: {
        'border-color': 'var(--destructive)',
        'box-shadow': `0 0 0 3px ${mix('destructive', dark ? 40 : 20)}`,
      },
      disabled: { opacity: '0.5' },
    }),
    'badge-default': recipe({
      base: { 'background-color': 'var(--primary)', color: 'var(--primary-foreground)' },
    }),
    'badge-secondary': recipe({
      base: { 'background-color': 'var(--secondary)', color: 'var(--secondary-foreground)' },
    }),
    'badge-destructive': recipe({
      base: { 'background-color': mix('destructive', dark ? 20 : 10), color: 'var(--destructive)' },
      focus: { 'box-shadow': `0 0 0 3px ${mix('destructive', dark ? 40 : 20)}` },
    }),
    'badge-outline': recipe({
      base: { 'border-color': 'var(--border)', color: 'var(--foreground)' },
    }),
    'badge-ghost': recipe({
      hover: {
        'background-color': dark ? mix('muted', 50) : 'var(--muted)',
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
