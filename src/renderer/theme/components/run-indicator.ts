import { recipe } from './recipe';

export const runIndicatorSelectors = {
  'run-indicator': '.theme-run-indicator',
  'run-indicator-icon': '.theme-run-indicator .theme-spinner',
  'run-indicator-elapsed': '.theme-run-indicator-elapsed',
};

export function runIndicatorAppearances() {
  return {
    'run-indicator': recipe({
      base: {
        height: '1.5rem',
        'padding-inline': '1rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1',
        color: 'var(--muted-foreground)',
      },
    }),
    'run-indicator-icon': recipe({ base: { width: '0.75rem', height: '0.75rem' } }),
    'run-indicator-elapsed': recipe({ base: { 'font-variant-numeric': 'tabular-nums' } }),
  };
}
