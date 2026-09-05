import { recipe } from './recipe';
import type { AppearanceStyle, ComponentAppearances } from './contract';
type SurfaceAppearances = Pick<
  ComponentAppearances,
  Extract<keyof ComponentAppearances, `card${string}` | `dialog-${string}` | `popover-${string}`>
>;
export function classicSurfaces(): SurfaceAppearances {
  const smallText = { 'font-size': 'var(--zy-component-text-sm)' };
  const title = {
    'font-size': 'var(--zy-component-text-base)',
    'font-weight': 'var(--zy-component-font-weight-medium)',
  };
  const description = { ...smallText, color: 'var(--muted-foreground)' };
  const upper = {
    'border-top-left-radius': 'var(--zy-style-radius-xl)',
    'border-top-right-radius': 'var(--zy-style-radius-xl)',
  };
  const lower = {
    'border-bottom-left-radius': 'var(--zy-style-radius-xl)',
    'border-bottom-right-radius': 'var(--zy-style-radius-xl)',
  };
  const popup: AppearanceStyle = {
    ...smallText,
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
    'outline-style': 'none',
    opacity: '1',
    scale: '1',
    'transition-property': 'opacity, scale',
    'transition-duration': '100ms',
    'transition-timing-function': 'ease-out',
  };
  const hidden = { opacity: '0', scale: '0.95' };
  return {
    card: recipe({
      base: {
        ...smallText,
        gap: '1rem',
        padding: '1rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--card)',
        color: 'var(--card-foreground)',
        'box-shadow': '0 0 0 1px var(--border)',
      },
    }),
    'card-small': recipe({ base: { padding: '0.75rem' } }),
    'card-interactive': recipe({
      base: {
        'transition-property': 'background-color, box-shadow, translate',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)' },
      pressed: { translate: '0 1px' },
      focus: {
        'outline-width': '2px',
        'outline-style': 'solid',
        'outline-color': 'var(--ring)',
        'outline-offset': '2px',
      },
      selected: { 'background-color': 'var(--zy-primary-muted)' },
      disabled: { opacity: '0.5' },
    }),
    'card-header': recipe({ base: { ...upper, 'padding-inline': '1rem' } }),
    'card-title': recipe({ base: { ...title, 'line-height': '1.375' } }),
    'card-title-small': recipe({ base: smallText }),
    'card-description': recipe({ base: description }),
    'card-content': recipe({ base: { 'padding-inline': '1rem' } }),
    'card-footer': recipe({
      base: {
        ...lower,
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)',
        padding: '1rem',
      },
    }),
    'dialog-content': recipe({
      base: {
        ...popup,
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--zy-surface-foreground)',
        'box-shadow': 'var(--zy-style-shadow-modal)',
        padding: '1rem',
        gap: '1rem',
      },
      entering: hidden,
      exiting: hidden,
    }),
    'dialog-overlay': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 10%, transparent)',
        opacity: '1',
        'transition-property': 'opacity',
        'transition-duration': '100ms',
      },
      entering: { opacity: '0' },
      exiting: { opacity: '0' },
    }),
    'dialog-immediate': recipe({ exiting: { 'transition-duration': '0s' } }),
    'dialog-title': recipe({ base: { ...title, 'line-height': '1' } }),
    'dialog-description': recipe({ base: description }),
    'dialog-footer': recipe({
      base: {
        ...lower,
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-top-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        padding: '1rem',
      },
    }),
    'popover-content': recipe({
      base: {
        ...popup,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-md)',
        padding: '0.625rem',
        gap: '0.625rem',
      },
      entering: hidden,
      exiting: hidden,
    }),
    'popover-title': recipe({ base: { 'font-weight': 'var(--zy-component-font-weight-medium)' } }),
    'popover-description': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'popover-header': recipe({ base: smallText }),
  };
}
