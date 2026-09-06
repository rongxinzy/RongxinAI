import { BackgroundFit, BackgroundKind, BackgroundTexture } from '../background/background';
import { classicDark } from './classic-dark';
import { classicLight } from './classic-light';
import type { ThemeDefinition } from './types';

/** Silk, peacock green and warm bronze. Interaction and layout remain shared with every package. */
function createChangan(dark: boolean): ThemeDefinition {
  const base = dark ? classicDark : classicLight;
  const canvas = dark ? '#182725' : '#F5F0E5';
  const sidebar = dark ? '#20322F' : '#EAE1CF';
  const surface = dark ? '#2A3D38' : '#FFFBF2';
  const ink = dark ? '#EEE7D8' : '#302C25';
  const muted = dark ? '#B5B3A4' : '#6C6355';
  const border = dark ? '#4C6258' : '#D9CEB8';
  const teal = dark ? '#8EBDB0' : '#28665D';
  const tealHover = dark ? '#ADD2C6' : '#20554D';
  const tealSoft = dark ? '#2E4840' : '#E1EAE0';
  const jade = dark ? '#A3C69B' : '#486440';
  const bronze = dark ? '#CBB17A' : '#7B602D';
  const blue = dark ? '#9BBCBE' : '#456B73';
  const danger = dark ? '#EDA394' : '#AB3837';
  const components = structuredClone(base.components);
  // Rounder surfaces share existing control geometry and interaction behavior.
  components.heading.base['font-weight'] = '600';
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
      id: dark ? 'changan-dark' : 'changan-light',
      name: dark ? '长安风物 · 夜阑' : '长安风物 · 绢白',
      description: 'Silk, peacock green and warm bronze desktop appearance',
      appearance: dark ? 'dark' : 'light',
    },
    components,
    background: {
      kind: BackgroundKind.Texture,
      color: '#927137',
      opacity: dark ? 0.025 : 0.045,
      texture: BackgroundTexture.Silk,
      fit: BackgroundFit.Tile,
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
      'semantic-sidebar-primary-foreground': dark ? '#152B25' : '#FFFBF2',
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
      'primary-foreground': dark ? '#152B25' : '#FFFBF2',
      'primary-muted': tealSoft,
      ring: teal,
      background: canvas,
      foreground: ink,
      surface,
      'surface-foreground': ink,
      'surface-raised': sidebar,
      'surface-tertiary': dark ? '#354A42' : '#E0D6C2',
      'surface-overlay': surface,
      accent: sidebar,
      'accent-foreground': ink,
      'chat-user': dark ? '#354A42' : '#EAE1CF',
      'chat-user-foreground': ink,
      'chat-bot': canvas,
      'chat-bot-foreground': ink,
      'text-primary': ink,
      'text-muted': muted,
      'text-muted-foreground': muted,
      border,
      'border-subtle': dark ? '#3D5149' : '#E6DDCB',
      'input-border': border,
      'scroll-thumb': dark ? '#678074' : '#B9AC91',
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
      radius: '0.75rem',
      'style-radius-xl': '1rem',
      'style-radius-2xl': '1.25rem',
      'style-radius-3xl': '1.5rem',
      'style-work-chat-track': sidebar,
      'style-work-chat-thumb': surface,
      'style-work-chat-thumb-radius': '10px',
      'style-switch-thumb': '#FFFBF2',
      'switch-thumb-foreground': ink,
      'style-shadow-glow-accent': 'none',
      'style-shadow-card': '0 2px 6px rgb(48 44 37 / 6%)',
      'style-shadow-popover': '0 10px 28px rgb(24 39 37 / 16%)',
      'component-editor-background': surface,
      'component-editor-foreground': ink,
      'component-editor-gutter': muted,
      'component-editor-selection': tealSoft,
      'component-editor-active-line': dark ? '#31473F' : '#EEE7D7',
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

export const changanLight = createChangan(false);
export const changanDark = createChangan(true);
