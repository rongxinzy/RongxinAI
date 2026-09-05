import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

type ButtonAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `button${string}`>
>;
const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;

export function classicButtons(dark: boolean): ButtonAppearances {
  const hover = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const raised = { 'background-color': 'var(--zy-surface-raised)' };
  const selected = {
    'border-color': 'var(--border)',
    'background-color': 'var(--card)',
    color: 'var(--foreground)',
  };
  const small = { 'border-radius': 'var(--zy-style-radius-md)' };
  return {
    button: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-style': 'solid',
        'border-width': '1px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'outline-style': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow, translate',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 3px ${mix('ring', 50)}` },
      pressed: { translate: '0 1px' },
      disabled: { opacity: '0.5' },
      invalid: {
        'border-color': dark ? mix('destructive', 50) : 'var(--destructive)',
        'box-shadow': `0 0 0 3px ${mix('destructive', dark ? 40 : 20)}`,
      },
    }),
    'button-default': recipe({
      base: { 'background-color': 'var(--zy-primary-strong)', color: 'var(--primary-foreground)' },
      hover: { 'background-color': mix('zy-primary-strong', 80) },
    }),
    'button-outline': recipe({
      base: {
        'border-color': dark ? 'var(--input)' : 'var(--border)',
        'background-color': dark ? mix('input', 30) : 'var(--background)',
      },
      hover: { ...hover, ...(dark ? { 'background-color': mix('input', 50) } : {}) },
      expanded: hover,
    }),
    'button-secondary': recipe({
      base: { 'background-color': 'var(--secondary)', color: 'var(--secondary-foreground)' },
      hover: { 'background-color': 'color-mix(in oklch, var(--secondary), var(--foreground) 5%)' },
      expanded: { 'background-color': 'var(--secondary)', color: 'var(--secondary-foreground)' },
    }),
    'button-ghost': recipe({
      hover: { ...hover, ...(dark ? { 'background-color': mix('muted', 50) } : {}) },
      expanded: hover,
    }),
    'button-prompt-selector': recipe({
      base: { 'transition-duration': '200ms' },
      hover: raised,
      expanded: raised,
    }),
    'button-navigation': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'transition-duration': '200ms',
      },
      hover: selected,
      selected: { ...selected, 'font-weight': 'var(--zy-component-font-weight-medium)' },
    }),
    'button-toolbar': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { ...raised, color: 'var(--foreground)' },
      expanded: { ...raised, color: 'var(--foreground)' },
    }),
    'button-destructive': recipe({
      base: { 'background-color': mix('destructive', dark ? 20 : 10), color: 'var(--destructive)' },
      hover: { 'background-color': mix('destructive', dark ? 30 : 20) },
      focus: {
        'border-color': mix('destructive', 40),
        'box-shadow': `0 0 0 3px ${mix('destructive', dark ? 40 : 20)}`,
      },
    }),
    'button-link': recipe({
      base: { color: 'var(--primary)', 'text-underline-offset': '4px' },
      hover: { 'text-decoration': 'underline' },
    }),
    'button-appearance': recipe({
      base: { 'border-color': 'var(--border)', 'background-color': 'var(--background)' },
      hover: { 'background-color': 'var(--muted)' },
      selected: {
        'border-color': 'var(--primary)',
        'background-color': 'var(--zy-primary-muted)',
        color: 'var(--primary)',
      },
    }),
    'button-size-default': recipe({
      base: { height: '2rem', gap: '0.375rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-xs': recipe({
      base: {
        ...small,
        height: '1.5rem',
        gap: '0.25rem',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'button-size-sm': recipe({
      base: { ...small, height: '1.75rem', gap: '0.25rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-lg': recipe({
      base: { height: '2.25rem', gap: '0.375rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-appearance': recipe({
      base: {
        height: 'auto',
        gap: '0.5rem',
        padding: '0.75rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'button-size-navigation': recipe({
      base: { height: '2rem', gap: '0.5rem', 'padding-inline': '0.75rem' },
    }),
    'button-size-icon': recipe({ base: { height: '2rem', width: '2rem' } }),
    'button-size-icon-xs': recipe({ base: { ...small, height: '1.5rem', width: '1.5rem' } }),
    'button-size-icon-sm': recipe({ base: { ...small, height: '1.75rem', width: '1.75rem' } }),
    'button-size-icon-lg': recipe({ base: { height: '2.25rem', width: '2.25rem' } }),
  };
}
