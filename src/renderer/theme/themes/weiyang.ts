import { BackgroundFit, BackgroundKind, BackgroundTexture } from '../background/background';
import { classicDark } from './classic-dark';
import { classicLight } from './classic-light';
import type { ThemeDefinition } from './types';

/** Lacquer black, antique gold and cloud scrolls. Interaction and layout remain shared with every package. */
function createWeiyang(dark: boolean): ThemeDefinition {
  const base = dark ? classicDark : classicLight;
  const canvas = dark ? '#171715' : '#F0EDE4';
  const sidebar = dark ? '#1E1E1A' : '#E5E0D3';
  const surface = dark ? '#23231F' : '#FAF7EF';
  const ink = dark ? '#E9E3D5' : '#292822';
  const muted = dark ? '#B7B0A0' : '#676153';
  const border = dark ? '#484438' : '#D2C9B5';
  const teal = dark ? '#C3A66A' : '#786035';
  const tealHover = dark ? '#D5BB85' : '#624C28';
  const tealSoft = dark ? '#373123' : '#E8DFCC';
  const jade = dark ? '#A3B59A' : '#4D654C';
  const bronze = dark ? '#CBB17A' : '#765A29';
  const blue = dark ? '#9BBCBE' : '#456B73';
  const danger = dark ? '#EDA394' : '#AB3837';
  const components = structuredClone(base.components);
  // Carved surfaces share existing control geometry and interaction behavior.
  components.heading.base['font-weight'] = '600';
  components['input-submit'].base['border-radius'] = '6px';
  components['switch-thumb'].checked['background-color'] = 'var(--zy-primary-foreground)';
  components.heading.base['letter-spacing'] = '0.02em';
  components['fluid-indicator'].base['border-radius'] = 'var(--zy-style-radius-md)';
  components['fluid-hover-indicator'].base['border-radius'] = 'var(--zy-style-radius-md)';
  components['fluid-indicator'].base['background-color'] = 'var(--zy-surface)';
  components['fluid-indicator'].base['box-shadow'] = 'var(--zy-style-shadow-subtle)';
  components['fluid-tab'].selected.color = 'var(--zy-primary)';
  components['fluid-tab'].base.opacity = '1';
  components['page-tabs-trigger'].selected.color = 'var(--zy-primary)';
  components['page-tabs-indicator'].base['background-color'] = 'var(--zy-primary)';
  return {
    meta: {
      id: dark ? 'weiyang-dark' : 'weiyang-light',
      name: dark ? '未央金石 · 玄金' : '未央金石 · 石白',
      description: 'Lacquer black, antique gold and cloud scrolls desktop appearance',
      appearance: dark ? 'dark' : 'light',
    },
    components,
    background: {
      kind: BackgroundKind.Texture,
      color: '#A88C53',
      opacity: dark ? 0.18 : 0.12,
      texture: BackgroundTexture.Clouds,
      fit: BackgroundFit.Cover,
    },
    tokens: {
      ...base.tokens,
      success: jade,
      warning: bronze,
      destructive: danger,
      'style-destructive-confirm': '#AB3837',
      'semantic-sidebar': sidebar,
      'semantic-sidebar-foreground': ink,
      'semantic-sidebar-primary': teal,
      'semantic-sidebar-primary-foreground': dark ? '#171715' : '#FAF7EF',
      'semantic-sidebar-accent': surface,
      'semantic-sidebar-accent-foreground': ink,
      'semantic-sidebar-border': border,
      'semantic-sidebar-ring': teal,
      'semantic-chart-1': teal,
      'semantic-chart-2': jade,
      'semantic-chart-3': bronze,
      'semantic-chart-4': blue,
      'semantic-chart-5': dark ? '#D99278' : '#A6533E',
      primary: teal,
      'primary-strong': teal,
      'primary-hover': tealHover,
      'primary-foreground': dark ? '#171715' : '#FAF7EF',
      'primary-muted': tealSoft,
      ring: teal,
      background: canvas,
      foreground: ink,
      surface,
      'surface-foreground': ink,
      'surface-raised': sidebar,
      'surface-tertiary': dark ? '#302E26' : '#DCD5C5',
      'surface-overlay': surface,
      accent: sidebar,
      'accent-foreground': ink,
      'chat-user': dark ? '#302E26' : '#E5E0D3',
      'chat-user-foreground': ink,
      'chat-bot': canvas,
      'chat-bot-foreground': ink,
      'text-primary': ink,
      'text-muted': muted,
      'text-muted-foreground': muted,
      border,
      'border-subtle': dark ? '#36342C' : '#E2DCCC',
      'input-border': border,
      'scroll-thumb': dark ? '#756D58' : '#B1A58B',
      'scroll-thumb-hover': muted,
      'gradient-1': canvas,
      'gradient-2': surface,
      'skill-blue-background': tealSoft,
      'skill-blue-foreground': teal,
      'model-tag-neutral-background': sidebar,
      'model-tag-neutral-foreground': muted,
      'model-tag-neutral-border': border,
      'model-tag-violet-background': dark ? '#453C35' : '#F0E2D5',
      'model-tag-violet-foreground': dark ? '#D99278' : '#914831',
      'model-tag-violet-border': border,
      'model-tag-green-background': dark ? '#2D4234' : '#E4EAD8',
      'model-tag-green-foreground': jade,
      'model-tag-green-border': border,
      'style-font-heading': '"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif',
      radius: '0.375rem',
      'style-radius-xl': '0.5rem',
      'style-radius-2xl': '0.5rem',
      'style-radius-3xl': '0.5rem',
      'style-work-chat-track': sidebar,
      'style-work-chat-thumb': surface,
      'style-work-chat-thumb-radius': '4px',
      'style-switch-thumb': '#FAF7EF',
      'switch-thumb-foreground': ink,
      'style-shadow-glow-accent': 'none',
      'style-shadow-card': '0 2px 6px rgb(48 44 37 / 6%)',
      'style-shadow-popover': '0 10px 28px rgb(24 39 37 / 16%)',
      'component-editor-background': surface,
      'component-editor-foreground': ink,
      'component-editor-gutter': muted,
      'component-editor-selection': tealSoft,
      'component-editor-active-line': dark ? '#2E2B23' : '#EEE7D7',
      'component-editor-search': dark ? '#615233' : '#EDE0BD',
      'component-editor-search-selected': dark ? '#7C6941' : '#D9C087',
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

export const weiyangLight = createWeiyang(false);
export const weiyangDark = createWeiyang(true);
