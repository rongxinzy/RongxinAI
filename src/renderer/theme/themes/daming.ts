import { BackgroundFit, BackgroundKind, BackgroundTexture } from '../background/background';
import { classicDark } from './classic-dark';
import { classicLight } from './classic-light';
import type { ThemeDefinition } from './types';

/** Paper, ink and cinnabar. Interaction and layout remain shared with every package. */
function createDaming(dark: boolean): ThemeDefinition {
  const base = dark ? classicDark : classicLight;
  const paper = dark ? '#1E201E' : '#F7F4ED';
  const sidebar = dark ? '#272925' : '#EEE8DC';
  const surface = dark ? '#30312C' : '#FFFCF6';
  const ink = dark ? '#E9E4D8' : '#292821';
  const muted = dark ? '#ABA597' : '#6C675C';
  const border = dark ? '#4E5048' : '#DED7C9';
  const red = dark ? '#DC8374' : '#AD3B30';
  const redHover = dark ? '#E79889' : '#933127';
  const redSoft = dark ? '#44302B' : '#F2E2D9';
  const jade = dark ? '#A1B29C' : '#536B57';
  const bronze = dark ? '#C9B17D' : '#80652F';
  const blue = dark ? '#9AB5B7' : '#49696D';
  const danger = dark ? '#F29A97' : '#AA3038';
  const components = structuredClone(base.components);
  // A compact shape language, without changing hit areas or wrapper layout.
  for (const name of ['fluid-indicator', 'fluid-hover-indicator', 'range-thumb'] as const) {
    components[name].base['border-radius'] = 'var(--zy-style-radius-md)';
  }
  components.switch.base['border-radius'] = 'var(--zy-style-radius-md)';
  components['switch-thumb'].base['border-radius'] = 'var(--zy-style-radius-sm)';
  components['fluid-indicator'].base['box-shadow'] = 'none';
  components['fluid-indicator'].base['border-color'] = 'var(--zy-primary)';
  components['fluid-indicator'].base['background-color'] = 'var(--zy-surface)';
  components['fluid-tab'].selected.color = 'var(--zy-primary)';
  components['fluid-tab'].base.opacity = '1';
  components['page-tabs-trigger'].selected.color = 'var(--zy-primary)';
  components['page-tabs-indicator'].base['background-color'] = 'var(--zy-primary)';
  return {
    meta: {
      id: dark ? 'daming-dark' : 'daming-light',
      name: dark ? '大明风华 · 墨夜' : '大明风华 · 纸白',
      description: 'Paper, ink and cinnabar desktop appearance',
      appearance: dark ? 'dark' : 'light',
    },
    components,
    background: {
      kind: dark ? BackgroundKind.None : BackgroundKind.Texture,
      color: '#706B60',
      opacity: dark ? 0 : 0.055,
      texture: BackgroundTexture.Paper,
      fit: BackgroundFit.Tile,
    },
    tokens: {
      ...base.tokens,
      success: jade,
      warning: bronze,
      destructive: danger,
      'style-destructive-confirm': '#AA3038',
      'semantic-sidebar': sidebar,
      'semantic-sidebar-foreground': ink,
      'semantic-sidebar-primary': red,
      'semantic-sidebar-primary-foreground': dark ? '#211D19' : '#FFFCF6',
      'semantic-sidebar-accent': surface,
      'semantic-sidebar-accent-foreground': ink,
      'semantic-sidebar-border': border,
      'semantic-sidebar-ring': red,
      'semantic-chart-1': red,
      'semantic-chart-2': jade,
      'semantic-chart-3': bronze,
      'semantic-chart-4': blue,
      'semantic-chart-5': muted,
      primary: red,
      'primary-strong': red,
      'primary-hover': redHover,
      'primary-foreground': dark ? '#211D19' : '#FFFCF6',
      'primary-muted': redSoft,
      ring: red,
      background: paper,
      foreground: ink,
      surface,
      'surface-foreground': ink,
      'surface-raised': sidebar,
      'surface-tertiary': dark ? '#383A33' : '#E8E1D4',
      'surface-overlay': surface,
      accent: sidebar,
      'accent-foreground': ink,
      'chat-user': dark ? '#383A33' : '#EEE8DC',
      'chat-user-foreground': ink,
      'chat-bot': paper,
      'chat-bot-foreground': ink,
      'text-primary': ink,
      'text-muted': muted,
      'text-muted-foreground': muted,
      border,
      'border-subtle': dark ? '#3E4039' : '#E9E2D5',
      'input-border': border,
      'scroll-thumb': dark ? '#64665C' : '#BCB4A5',
      'scroll-thumb-hover': muted,
      'gradient-1': paper,
      'gradient-2': surface,
      'skill-blue-background': redSoft,
      'skill-blue-foreground': red,
      'model-tag-neutral-background': sidebar,
      'model-tag-neutral-foreground': muted,
      'model-tag-neutral-border': border,
      'model-tag-violet-background': dark ? '#353C3C' : '#E8EFEB',
      'model-tag-violet-foreground': blue,
      'model-tag-violet-border': border,
      'model-tag-green-background': dark ? '#303D32' : '#E8EDDF',
      'model-tag-green-foreground': jade,
      'model-tag-green-border': border,
      'style-font-heading': '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif',
      radius: '0.5rem',
      'style-radius-xl': '0.625rem',
      'style-radius-2xl': '0.625rem',
      'style-radius-3xl': '0.75rem',
      'style-work-chat-track': sidebar,
      'style-work-chat-thumb': surface,
      'style-work-chat-thumb-radius': '6px',
      'style-switch-thumb': '#FFFCF6',
      'switch-thumb-foreground': ink,
      'style-shadow-glow-accent': 'none',
      'style-shadow-card': '0 1px 2px rgb(41 40 33 / 5%)',
      'style-shadow-popover': '0 8px 24px rgb(20 20 16 / 14%)',
      'component-editor-background': surface,
      'component-editor-foreground': ink,
      'component-editor-gutter': muted,
      'component-editor-selection': redSoft,
      'component-editor-active-line': dark ? '#35372F' : '#F0EBDD',
      'component-editor-search': dark ? '#645235' : '#EEE0BA',
      'component-editor-search-selected': dark ? '#886943' : '#DBC28A',
      'component-palette-amber-50': dark ? '#393326' : '#F2EADA',
      'component-palette-amber-200': dark ? '#766441' : '#DCCCA8',
      'component-palette-amber-400': bronze,
      'component-palette-amber-500': bronze,
      'component-palette-amber-700': bronze,
      'component-palette-amber-800': bronze,
      'component-palette-amber-950': '#393326',
      'component-palette-yellow-50': dark ? '#393326' : '#F2EADA',
      'component-palette-yellow-200': dark ? '#766441' : '#DCCCA8',
      'component-palette-yellow-400': bronze,
      'component-palette-yellow-500': bronze,
      'component-palette-yellow-600': bronze,
      'component-palette-yellow-700': bronze,
      'component-palette-yellow-800': bronze,
      'component-palette-yellow-900': '#393326',
      'component-palette-red-50': dark ? '#3D2B2B' : '#F4E1DE',
      'component-palette-red-200': dark ? '#77514D' : '#DDBDB7',
      'component-palette-red-400': danger,
      'component-palette-red-500': danger,
      'component-palette-red-600': danger,
      'component-palette-red-700': danger,
      'component-palette-red-800': danger,
      'component-palette-red-900': '#4B292B',
      'component-palette-blue-400': blue,
      'component-palette-blue-500': blue,
      'component-palette-blue-600': blue,
      'component-palette-green-400': jade,
      'component-palette-green-500': jade,
      'component-palette-green-600': jade,
      'component-palette-orange-500': bronze,
      'component-palette-orange-600': bronze,
      'component-palette-gray-300': border,
      'component-palette-gray-400': muted,
      'component-palette-gray-600': muted,
    },
  };
}

export const damingLight = createDaming(false);
export const damingDark = createDaming(true);
