import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';

type CodingDiffAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `coding-diff${string}`>
>;

export function classicCodingDiff(): CodingDiffAppearances {
  const gutter = {
    'font-variant-numeric': 'tabular-nums',
    'text-align': 'right',
    opacity: '0.6',
    padding: '0 0.5rem',
  };

  return {
    'coding-diff': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
      },
    }),
    'coding-diff-line-added': recipe({
      base: {
        'border-left-width': '4px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-component-diff-added)',
        'background-color': 'var(--zy-component-diff-added-background)',
      },
    }),
    'coding-diff-line-removed': recipe({
      base: {
        'border-left-width': '4px',
        'border-style': 'solid',
        'border-left-color': 'var(--zy-component-diff-removed)',
        'background-color': 'var(--zy-component-diff-removed-background)',
      },
    }),
    'coding-diff-line-context': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'coding-diff-line-header': recipe({
      base: {
        'background-color': 'color-mix(in oklab, var(--muted) 40%, transparent)',
        color: 'var(--muted-foreground)',
      },
    }),
    'coding-diff-gutter-added': recipe({ base: { ...gutter, color: 'var(--zy-component-diff-added)' } }),
    'coding-diff-gutter-removed': recipe({ base: { ...gutter, color: 'var(--zy-component-diff-removed)' } }),
    'coding-diff-gutter-context': recipe({ base: { ...gutter, color: 'var(--muted-foreground)' } }),
    'coding-diff-gutter-header': recipe({ base: { ...gutter, color: 'var(--muted-foreground)' } }),
    'coding-diff-prefix': recipe({ base: { 'text-align': 'center', padding: '0 0.25rem' } }),
    'coding-diff-code': recipe({ base: { padding: '0 0.5rem', color: 'var(--foreground)' } }),
  };
}
