import { recipe } from './recipe';

export function shellMainAppearances() {
  return {
    'shell-main': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--background)',
        'box-shadow': '0 0 0 1px var(--border), var(--zy-style-shadow-xs)',
      },
    }),
  };
}
