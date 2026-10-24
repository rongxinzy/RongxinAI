import type { ComponentAppearances } from './contract';
import { recipe } from './recipe';

/** Apply the shared input boundary contract after a theme's composition recipes. */
export function withAccessibleComposer(appearances: ComponentAppearances): ComponentAppearances {
  const composer = appearances['composer-input-surface'];
  const focus = {
    'border-color': 'var(--zy-text-muted)',
    'outline-style': 'solid',
    'outline-width': '2px',
    'outline-color': 'var(--primary)',
    'outline-offset': '1px',
  };
  return {
    ...appearances,
    'composer-input-surface': recipe({
      ...composer,
      base: { ...composer.base, 'border-color': 'var(--zy-text-muted)' },
      hover: { ...composer.hover, 'border-color': 'var(--zy-text-muted)' },
      groupFocus: { ...composer.groupFocus, ...focus },
      composerFocus: { ...composer.composerFocus, ...focus },
    }),
  };
}
