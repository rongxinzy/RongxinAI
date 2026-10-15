import { BackgroundFit, BackgroundKind, BackgroundTexture } from '../background/background';
import { classicDark } from './classic-dark';
import { classicLight } from './classic-light';
import type { ThemeDefinition } from './types';

/** Xiaoruan red brand palette. Layout and component behavior remain shared. */
function createXiaoruan(dark: boolean): ThemeDefinition {
  const base = dark ? classicDark : classicLight;
  const red = dark ? 'oklch(0.74 0.13 25)' : 'oklch(0.48 0.18 25)';
  const redHover = dark ? 'oklch(0.79 0.1 25)' : 'oklch(0.43 0.16 25)';
  const redSoft = dark ? 'oklch(0.3 0.05 25)' : 'oklch(0.96 0.018 25)';
  const components = structuredClone(base.components);
  components['fluid-tab'].selected.color = 'var(--zy-primary)';
  components['page-tabs-trigger'].selected.color = 'var(--zy-primary)';
  components['page-tabs-indicator'].base['background-color'] = 'var(--zy-primary)';
  return {
    meta: {
      id: dark ? 'xiaoruan-dark' : 'xiaoruan-light',
      name: dark ? '晓软红 · 深色' : '晓软红 · 浅色',
      description: 'Xiaoruan red brand desktop appearance',
      appearance: dark ? 'dark' : 'light',
    },
    components,
    background: {
      kind: BackgroundKind.Image,
      image: './themes/xiaoruan-background.svg',
      color: '#b58b49',
      opacity: dark ? 0.2 : 0.35,
      texture: BackgroundTexture.Clouds,
      fit: BackgroundFit.Cover,
    },
    tokens: {
      ...base.tokens,
      background: dark ? '#191716' : '#fdfbf8',
      primary: red,
      'primary-strong': dark ? 'oklch(0.48 0.18 25)' : red,
      'primary-hover': redHover,
      'primary-muted': redSoft,
      ring: red,
      'skill-blue-background': redSoft,
      'skill-blue-foreground': red,
      'semantic-sidebar-primary': red,
      'semantic-sidebar-ring': red,
      'semantic-chart-1': red,
      'semantic-sidebar-accent': dark ? 'oklch(0.268 0.007 34.298)' : 'oklch(0.97 0.001 106.424)',
    },
  };
}

export const xiaoruanLight = createXiaoruan(false);
export const xiaoruanDark = createXiaoruan(true);
