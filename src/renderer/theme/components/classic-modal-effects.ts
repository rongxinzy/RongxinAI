import { modalOverlayBlur, modalOverlayScrim } from './modal-overlay-style';
import { recipe } from './recipe';

export function classicModalEffects() {
  const surface = {
    'background-color': 'var(--zy-surface)',
    'border-radius': 'var(--zy-style-radius-2xl)',
    'box-shadow': 'var(--zy-style-shadow-modal)',
  };
  const border = {
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
  };
  const entrance = {
    'animation-name': 'component-motion',
    'animation-duration': '200ms',
    'animation-timing-function': 'ease-out',
  };
  return {
    'legacy-modal-backdrop': recipe({
      base: {
        ...entrance,
        ...modalOverlayScrim,
      },
      motionStart: { opacity: '0' },
      motionEnd: { opacity: '1' },
    }),
    'legacy-modal-content': recipe({
      base: { ...surface, ...entrance },
      motionStart: { opacity: '0', scale: '0.95' },
      motionEnd: { opacity: '1', scale: '1' },
    }),
    'legacy-permission-inline-surface': recipe({
      base: {
        ...surface,
        ...border,
        'background-color': 'var(--zy-surface-raised)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
      },
    }),
    'settings-modal-frame': recipe({ base: { ...surface, ...border, 'border-radius': 'inherit' } }),
    'settings-modal-shell': recipe({
      base: { 'background-color': 'transparent', 'box-shadow': 'none' },
    }),
    'local-context-modal': recipe({
      base: {
        ...border,
        'background-color': 'var(--zy-surface)',
        'border-radius': 'var(--zy-style-radius-xl)',
      },
    }),
    'local-capability-modal': recipe({
      base: { ...border, ...surface, 'border-radius': 'var(--zy-style-radius-xl)' },
    }),
    'skill-modal-backdrop': recipe({
      base: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 60%, transparent)',
        ...modalOverlayBlur,
      },
    }),
    'skill-security-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-xl)' },
    }),
    'skill-import-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-2xl)' },
    }),
    'composer-near': recipe({ base: { opacity: '0', 'box-shadow': 'none' } }),
    'composer-far': recipe({ base: { opacity: '0', 'box-shadow': 'none' } }),
  };
}
