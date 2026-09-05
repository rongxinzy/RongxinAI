import { recipe } from './recipe';

export function classicModalEffects(dark: boolean) {
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
  const aura = {
    'border-radius': 'inherit',
    opacity: '0',
    scale: '0.985',
    'transition-property': 'opacity, scale',
    'transition-duration': '520ms',
    'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
  const focused = {
    opacity: '1',
    scale: '1',
    'transition-duration': '340ms',
    'transition-timing-function': 'cubic-bezier(0.16, 1, 0.3, 1)',
  };
  return {
    'legacy-modal-backdrop': recipe({
      base: {
        ...entrance,
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-black) 10%, transparent)',
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
      },
    }),
    'skill-security-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-xl)' },
    }),
    'skill-import-modal': recipe({
      base: { ...surface, ...border, 'box-shadow': 'var(--zy-style-shadow-2xl)' },
    }),
    'composer-near': recipe({
      base: {
        ...aura,
        'box-shadow':
          '0 0 0 1px color-mix(in srgb, var(--zy-primary) 38%, transparent), 0 0 10px color-mix(in srgb, var(--zy-primary) 15%, transparent), 0 4px 14px -6px color-mix(in srgb, var(--zy-primary) 16%, transparent)',
      },
      composerFocus: focused,
    }),
    'composer-far': recipe({
      base: {
        ...aura,
        'box-shadow': dark
          ? '0 0 26px 2px color-mix(in srgb, var(--zy-primary) 14%, transparent), 0 0 60px 10px color-mix(in srgb, var(--zy-primary) 8%, transparent)'
          : '0 0 22px 1px color-mix(in srgb, var(--zy-primary) 10%, transparent), 0 0 52px 8px color-mix(in srgb, var(--zy-primary) 5%, transparent)',
      },
      composerFocus: {
        ...focused,
        'animation-name': 'component-motion',
        'animation-duration': '5.2s',
        'animation-delay': '340ms',
        'animation-timing-function': 'cubic-bezier(0.45, 0, 0.55, 1)',
        'animation-iteration-count': 'infinite',
        'animation-direction': 'alternate',
      },
      motionStart: { opacity: '0.6', scale: '0.995' },
      motionEnd: { opacity: '1', scale: '1.005' },
    }),
  };
}
