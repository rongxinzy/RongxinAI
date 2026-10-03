import { recipe } from './recipe';
import type { ComponentAppearances } from './contract';
type ProductAppearances = Pick<
  ComponentAppearances,
  Extract<
    keyof ComponentAppearances,
    | `permission-${string}`
    | `model-${string}`
    | `selector-option-${string}`
    | `market-card${string}`
  >
>;
export function classicProductControls(dark: boolean): ProductAppearances {
  return {
    'permission-menu': recipe({ base: { padding: '0.5rem' } }),
    'permission-option': recipe({
      base: {
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline-start': '0.5rem',
        'padding-inline-end': '2rem',
        'padding-block': '0.625rem',
      },
      checked: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'model-menu': recipe({ base: { padding: '0px' } }),
    'selector-option-title': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'selector-option-description': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', color: 'var(--muted-foreground)' },
    }),
    'market-card': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--card)',
        padding: '1rem',
        'box-shadow': 'none',
      },
    }),
    'market-card-header': recipe({ base: { padding: '0px' } }),
    'market-card-content': recipe({ base: { padding: '0px' } }),
    'market-card-footer': recipe({
      base: { 'border-top-width': '0px', 'background-color': 'transparent', padding: '0px' },
    }),
    'market-card-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
      },
    }),
    'market-card-description': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'permission-danger-banner': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.75rem',
      },
    }),
    // Light mode darkens the status hue for text so 14px titles keep AA
    // contrast on the tinted surface; dark tokens are already bright enough.
    'permission-danger-banner-destructive': recipe({
      base: {
        'background-color': dark
          ? 'color-mix(in oklab, var(--zy-destructive) 16%, transparent)'
          : 'color-mix(in oklab, var(--zy-destructive) 8%, transparent)',
        'border-color': dark
          ? 'color-mix(in oklab, var(--zy-destructive) 40%, transparent)'
          : 'color-mix(in oklab, var(--zy-destructive) 25%, transparent)',
        color: dark
          ? 'var(--zy-destructive)'
          : 'color-mix(in oklab, var(--zy-destructive) 70%, var(--zy-component-palette-black))',
      },
    }),
    'permission-danger-banner-warning': recipe({
      base: {
        'background-color': dark
          ? 'color-mix(in oklab, var(--zy-warning) 14%, transparent)'
          : 'color-mix(in oklab, var(--zy-warning) 10%, transparent)',
        'border-color': dark
          ? 'color-mix(in oklab, var(--zy-warning) 35%, transparent)'
          : 'color-mix(in oklab, var(--zy-warning) 30%, transparent)',
        color: dark
          ? 'var(--zy-warning)'
          : 'color-mix(in oklab, var(--zy-warning) 60%, var(--zy-component-palette-black))',
      },
    }),
  };
}
