import type { AppearanceStyle } from './contract';

// 2026/09/16 lixiang  弹窗遮罩公共样式，对齐外链确认弹窗：半透明黑底 + 2px 模糊
export const modalOverlayBlur: AppearanceStyle = {
  'backdrop-filter': 'blur(2px)',
};

export const modalOverlayScrim: AppearanceStyle = {
  'background-color':
    'color-mix(in oklab, var(--zy-component-palette-black) 20%, transparent)',
  ...modalOverlayBlur,
};
