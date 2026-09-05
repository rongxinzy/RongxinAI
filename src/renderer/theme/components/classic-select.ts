import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

type SelectAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `select-${string}`>
>;
const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;
export function classicSelect(dark: boolean): SelectAppearances {
  const highlight = { 'background-color': 'var(--accent)', color: 'var(--accent-foreground)' };
  return {
    'select-trigger': recipe({
      base: {
        height: '2rem',
        gap: '0.375rem',
        'padding-block': '0.5rem',
        'padding-inline-start': '0.625rem',
        'padding-inline-end': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--input)',
        'background-color': dark ? mix('input', 30) : 'var(--zy-surface)',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: {
        'border-color': mix('ring', 50),
        ...(dark ? { 'background-color': mix('input', 50) } : {}),
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 1px ${mix('ring', 40)}` },
      invalid: {
        'border-color': dark ? mix('destructive', 50) : 'var(--destructive)',
        'box-shadow': `0 0 0 1px ${mix('destructive', 40)}`,
      },
      disabled: { opacity: '0.5' },
      empty: { color: 'var(--muted-foreground)' },
    }),
    'select-trigger-small': recipe({
      base: { height: '1.75rem', 'border-radius': 'var(--zy-style-radius-md)' },
    }),
    'select-item': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-block': '0.25rem',
        'padding-inline-start': '0.375rem',
        'padding-inline-end': '2rem',
        gap: '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      highlighted: highlight,
      disabled: { opacity: '0.5' },
    }),
    'select-label': recipe({
      base: {
        padding: '0.25rem 0.375rem',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
      },
    }),
    'select-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'select-scroll': recipe({ base: { 'background-color': 'var(--popover)' } }),
    'select-icon': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'select-content': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-md)',
        opacity: '1',
        scale: '1',
        'transition-property': 'opacity, scale',
        'transition-duration': '100ms',
        'transition-timing-function': 'ease-out',
      },
      entering: { opacity: '0', scale: '0.95' },
      exiting: { opacity: '0', scale: '0.95' },
    }),
  };
}
