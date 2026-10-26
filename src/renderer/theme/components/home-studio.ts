import { recipe } from './recipe';

/** Studio home surfaces inherit every package's colors and typography. */
export function homeStudioAppearances() {
  return {
    'companion-window': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-bubble': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-sketch': recipe({ base: { color: 'var(--foreground)' } }),
    'companion-sketch-paper': recipe({ base: { fill: 'var(--popover)' } }),
    'companion-pencil-warm': recipe({ base: { color: '#b98267' } }),
    'companion-pencil-cool': recipe({ base: { color: '#6e998b' } }),
    'companion-paper-content': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-name': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', 'font-weight': '500' },
    }),
    'companion-selector': recipe({
      base: {
        'border-color': 'transparent',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'var(--accent)' },
    }),
    'companion-paper-input': recipe({
      base: {
        'border-color': 'var(--zy-text-muted)',
        'background-color': 'transparent',
        'border-radius': '0',
        'border-top-width': '0',
        'border-left-width': '0',
        'border-right-width': '0',
        'border-bottom-width': '2px',
        'box-shadow': 'none',
      },
      groupFocus: {
        'outline-style': 'none',
        'outline-width': '0',
        'box-shadow': 'none',
        'border-color': 'var(--primary)',
      },
    }),
    'welcome-screen': recipe({
      base: {
        'background-color': 'var(--background)',
        color: 'var(--foreground)',
        'transition-property': 'opacity',
        'transition-duration': '200ms',
      },
      exiting: { opacity: '0' },
    }),
    'welcome-title': recipe({
      base: { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' },
    }),
    'welcome-art': recipe({
      base: {
        width: 'min(52rem, 88vw)',
        height: 'min(24rem, 44vh)',
        'animation-name': 'component-motion',
        'animation-duration': '240ms',
        'animation-timing-function': 'ease-out',
        'animation-fill-mode': 'both',
      },
      motionStart: { opacity: '0', translate: '0 0.5rem' },
      motionEnd: { opacity: '1', translate: '0 0' },
    }),
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
