import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

type ButtonAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `button${string}`>
>;
const mix = (token: string, amount: number) =>
  `color-mix(in oklab, var(--${token}) ${amount}%, transparent)`;

export function classicButtons(): ButtonAppearances {
  const hover = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  // Toolbar chips sit on the raised composer/card surface, so their hover
  // needs the neutral fill step, not another coat of the same raised color.
  const chip = { 'background-color': 'var(--accent)' };
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
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      focus: { 'border-color': 'var(--ring)', 'box-shadow': `0 0 0 3px ${mix('ring', 50)}` },
      pressed: { translate: '0 1px' },
      disabled: { opacity: '0.5' },
      invalid: {
        'border-color': 'var(--zy-state-destructive-border)',
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
      },
    }),
    'button-default': recipe({
      base: { 'background-color': 'var(--zy-primary-strong)', color: 'var(--primary-foreground)' },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-primary-strong) 90%, black)',
      },
    }),
    'button-outline': recipe({
      base: {
        'border-color': 'var(--zy-state-input-border)',
        'background-color': 'var(--zy-state-input-solid)',
      },
      hover: { ...hover, 'background-color': 'var(--zy-state-input-hover)' },
      expanded: hover,
    }),
    // v4 secondary: neutral raised surface (card + border + shadow-xs), the
    // shape that carries emphasis without spending the brand color.
    'button-secondary': recipe({
      base: {
        'background-color': 'var(--card)',
        color: 'var(--foreground)',
        'border-color': 'var(--zy-border)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      expanded: { 'background-color': 'var(--card)', color: 'var(--foreground)' },
    }),
    'button-ghost': recipe({
      hover: { ...hover, 'background-color': 'var(--zy-state-muted-hover)' },
      expanded: hover,
    }),
    'button-embedded': recipe({
      base: { color: 'inherit', 'background-color': 'transparent' },
    }),
    'button-prompt-selector': recipe({
      base: { 'transition-duration': '120ms' },
      hover: { ...chip, color: 'var(--foreground)' },
      expanded: { ...chip, color: 'var(--foreground)' },
    }),
    'button-navigation': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'transition-duration': '120ms',
      },
      hover: {
        'background-color': mix('sidebar-foreground', 6),
        color: 'var(--sidebar-foreground)',
      },
      selected: {
        'background-color': mix('sidebar-foreground', 8),
        color: 'var(--sidebar-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),

    'button-toolbar': recipe({
      base: { color: 'var(--muted-foreground)', 'transition-duration': '120ms' },
      hover: { ...chip, color: 'var(--foreground)' },
      expanded: { ...chip, color: 'var(--foreground)' },
    }),
    'button-destructive': recipe({
      base: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-tint-percent), transparent)`,
        color: 'var(--destructive)',
      },
      hover: {
        'background-color': `color-mix(in oklab, var(--destructive) var(--zy-state-destructive-hover-tint-percent), transparent)`,
      },
      focus: {
        'border-color': mix('destructive', 40),
        'box-shadow': `0 0 0 3px color-mix(in oklab, var(--destructive) var(--zy-state-destructive-focus-ring), transparent)`,
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
        'background-color': 'var(--background)',
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
