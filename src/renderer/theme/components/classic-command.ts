import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type CommandAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `command${string}` | 'task-search-dialog'>
>;
export function classicCommand(): CommandAppearances {
  const small = { 'font-size': 'var(--zy-component-text-sm)' };
  const muted = { color: 'var(--muted-foreground)' };
  const highlight = { 'background-color': 'var(--muted)', color: 'var(--foreground)' };
  const input = {
    ...small,
    'border-width': '0px',
    'background-color': 'transparent',
    'outline-style': 'none',
  };
  return {
    'command-list': recipe({ base: { 'outline-style': 'none' } }),

    command: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        padding: '0.25rem',
      },
    }),
    'command-input': recipe({ base: input, disabled: { opacity: '0.5' } }),
    'command-palette-input': recipe({
      base: { ...input, height: '3rem', 'padding-inline': '0.75rem', color: 'var(--foreground)' },
      placeholder: muted,
      disabled: { opacity: '0.5' },
    }),
    'command-input-group': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-color': 'color-mix(in oklab, var(--input) 30%, transparent)',
        'background-color': 'var(--zy-surface-raised)',
        'box-shadow': 'none',
      },
      groupFocus: { 'box-shadow': 'none' },
    }),
    'command-item': recipe({
      base: {
        ...small,
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        padding: '0.375rem 0.5rem',
        'outline-style': 'none',
      },
      hover: highlight,
      focus: highlight,
      disabled: { opacity: '0.5' },
    }),
    'command-item-selector': recipe({
      base: { 'border-radius': 'var(--zy-style-radius-lg)', 'padding-block': '0.5rem' },
      selected: highlight,
    }),
    'command-item-palette': recipe({
      base: { height: '2rem', 'border-radius': '9999px' },
      selected: highlight,
    }),
    'command-empty': recipe({ base: { ...small, ...muted } }),
    'command-group': recipe({ base: { color: 'var(--foreground)' } }),
    'command-heading': recipe({
      base: {
        ...muted,
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        padding: '0.375rem 0.5rem',
      },
    }),
    'command-separator': recipe({ base: { 'background-color': 'var(--border)' } }),
    'command-shortcut': recipe({ base: { ...muted, 'font-size': 'var(--zy-component-text-xs)' } }),
    'task-search-dialog': recipe({
      base: { 'border-radius': 'var(--zy-style-radius-2xl)', padding: '0.25rem', gap: '0px' },
    }),
  };
}
