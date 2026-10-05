import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type SettingsAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    | `shortcut-${string}`
    | `send-shortcut-${string}`
    | 'auth-choice'
    | 'code-header-button'
    | 'code-hint'
  >
>;
export function classicSettingsControls(): SettingsAppearances {
  const surface = { 'background-color': 'var(--zy-surface-raised)', color: 'var(--foreground)' };
  const highlight = {
    'background-color': 'color-mix(in oklab, var(--primary) 10%, transparent)',
    color: 'var(--primary)',
  };
  const codeHighlight = { 'background-color': 'var(--zy-surface)', color: 'var(--foreground)' };
  return {
    'shortcut-input': recipe({
      base: {
        ...surface,
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-color': 'var(--border)',
      },
      hover: { 'border-color': 'color-mix(in oklab, var(--primary) 50%, transparent)' },
    }),
    'shortcut-recording': recipe({
      base: {
        'border-color': 'var(--primary)',
        'box-shadow': '0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent)',
        color: 'var(--muted-foreground)',
      },
      focus: { 'border-color': 'var(--primary)', color: 'var(--muted-foreground)' },
      hover: { 'border-color': 'var(--primary)' },
    }),
    'send-shortcut-trigger': recipe({
      base: {
        ...surface,
        'border-color': 'var(--border)',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
      },
    }),
    'send-shortcut-popup': recipe({ base: surface }),
    'send-shortcut-option': recipe({
      base: { color: 'var(--foreground)' },
      focus: highlight,
      highlighted: highlight,
    }),
    'auth-choice': recipe({
      base: {
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'var(--border)',
        opacity: '0.6',
        'transition-property': 'background-color, border-color, opacity',
      },
      hover: { opacity: '0.8' },
      selected: {
        'border-color': 'var(--primary)',
        'background-color': 'color-mix(in oklab, var(--primary) 5%, transparent)',
        opacity: '1',
      },
    }),
    'code-header-button': recipe({
      base: {
        height: '1.75rem',
        width: '1.75rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--muted-foreground)',
      },
      hover: codeHighlight,
      selected: codeHighlight,
    }),
    'code-hint': recipe({
      base: {
        'background-color': 'var(--zy-surface-overlay)',
        color: 'var(--foreground)',
        'border-color': 'var(--border)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
  };
}
