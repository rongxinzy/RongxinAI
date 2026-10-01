import { recipe } from './recipe';

/** Content loading uses the theme's primary color for the entire mark. */
export function logoLoadingAppearances() {
  return {
    'logo-loading-mark': recipe({
      base: { width: '8rem', height: 'auto', color: 'var(--primary)' },
    }),
    'logo-loading-dot': recipe({
      base: {
        opacity: '1',
        'animation-name': 'component-motion',
        'animation-duration': '1.2s',
        'animation-timing-function': 'ease-out',
        'animation-iteration-count': 'infinite',
        'animation-direction': 'alternate',
      },
      motionStart: { opacity: '1' },
      motionEnd: { opacity: '0.35' },
    }),
    'logo-loading-label': recipe({
      base: {
        color: 'var(--muted-foreground)',
        'font-size': '0.875rem',
        'line-height': '1.5',
      },
    }),
  };
}
