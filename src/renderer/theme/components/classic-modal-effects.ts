import { modalOverlayBlur, modalOverlayScrim } from './modal-overlay-style';
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
  // 2026/09/18 lixiang  只去掉 scale，避免获焦/失焦边框内收；光晕尺寸保持原样
  const aura = {
    'border-radius': 'inherit',
    opacity: '0',
    scale: '1',
    'transition-property': 'opacity',
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
    'composer-near': recipe({
      base: {
        ...aura,
        // 近层线框：单圈 1px + 轻柔近光，避免与 input-group 边框叠成粗线
        'box-shadow':
          '0 0 0 1px color-mix(in oklch, var(--zy-primary) 45%, transparent), 0 0 6px color-mix(in oklch, var(--zy-primary) 28%, transparent)',
      },
      composerFocus: focused,
    }),
    'composer-far': recipe({
      base: {
        ...aura,
        // 远层光晕：缩小模糊与扩散，保留轻微呼吸感
        'box-shadow': dark
          ? '0 0 10px 0 color-mix(in oklch, var(--zy-primary) 42%, transparent), 0 0 22px 2px color-mix(in oklch, var(--zy-primary) 22%, transparent)'
          : '0 0 8px 0 color-mix(in oklch, var(--zy-primary) 36%, transparent), 0 0 18px 2px color-mix(in oklch, var(--zy-primary) 18%, transparent)',
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
      // 2026/09/18 lixiang  呼吸动画不再改 scale，避免失焦时边框内收
      motionStart: { opacity: '0.6' },
      motionEnd: { opacity: '1' },
    }),
  };
}
