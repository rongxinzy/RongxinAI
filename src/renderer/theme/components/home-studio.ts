import { recipe } from './recipe';

/** Studio home surfaces inherit every package's colors and typography. */
export function homeStudioAppearances() {
  return {
    'home-brand': recipe({ base: { height: '3rem' } }),
    'home-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
      },
    }),
    'home-sticky': recipe({ base: { 'background-color': 'var(--background)' } }),
    'home-prompt-editor': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'min-height': '6rem',
      },
    }),
    'home-folder-warning': recipe({
      base: {
        padding: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--popover)',
        color: 'var(--foreground)',
        'font-size': 'var(--zy-component-text-xs)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
    'home-status': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'home-status-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--muted-foreground)' },
    }),
    'home-status-fading': recipe({ base: { opacity: '0' } }),
  };
}
