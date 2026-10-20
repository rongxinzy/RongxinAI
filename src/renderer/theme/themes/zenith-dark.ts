import { BackgroundKind, DEFAULT_BACKGROUND } from '../background/background';
import { classicComponentAppearances } from '../components/classic';
import type { ThemeDefinition } from './types';

/**
 * Zenith Dark — DESIGN.md v4 "Quiet Studio".
 *
 * Dark mode redefines hierarchy instead of inverting it: surfaces step up in
 * brightness, shadows are pure black (shadow-xs is none), and the brightened
 * brand blue stays reserved for executable actions, focus and running state.
 */
export const zenithDark: ThemeDefinition = {
  meta: {
    id: 'zenith-dark',
    name: 'Zenith Dark',
    description: 'Quiet Studio dark theme: neutral hierarchy, brand blue for action only',
    appearance: 'dark',
  },
  components: classicComponentAppearances(),
  background: {
    ...DEFAULT_BACKGROUND,
    kind: BackgroundKind.Color,
    color: '#0F1013',
    opacity: 1,
  },
  tokens: {
    // ── Typography Scale (six steps: 12/14/16/18/20/24) ──
    'component-text-xs': '12px',
    'component-text-xs--line-height': '16px',
    'component-text-sm': '14px',
    'component-text-sm--line-height': '20px',
    'component-text-base': '16px',
    'component-text-base--line-height': '24px',
    'component-text-lg': '18px',
    'component-text-lg--line-height': '28px',
    'component-text-xl': '20px',
    'component-text-xl--line-height': '28px',
    'component-text-2xl': '24px',
    'component-text-2xl--line-height': '32px',
    'component-text-3xl': '30px',
    'component-text-3xl--line-height': '38px',
    'component-text-4xl': '36px',
    'component-text-4xl--line-height': '44px',
    'component-text-5xl': '48px',
    'component-text-5xl--line-height': '56px',
    'component-text-6xl': '56px',
    'component-text-6xl--line-height': '64px',
    'component-text-7xl': '64px',
    'component-text-7xl--line-height': '72px',
    'component-text-8xl': '72px',
    'component-text-8xl--line-height': '80px',
    'component-text-9xl': '80px',
    'component-text-9xl--line-height': '88px',
    'style-text-xxl': '24px',
    'style-text-xxl--line-height': '32px',
    'style-body-leading': '1.5',

    // ── Font Weights (400/500/600 only; bold maps down to 600) ──
    'component-font-weight-normal': '400',
    'component-font-weight-medium': '500',
    'component-font-weight-semibold': '600',
    'component-font-weight-bold': '600',

    // ── Font Stacks ──
    'style-font-sans':
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
    'style-font-mono': "'SF Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
    'style-font-heading':
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",

    // ── Border Radius (4/6/8/12/16/20) ──
    radius: '8px',
    'style-radius-sm': '4px',
    'style-radius-md': '6px',
    'style-radius-lg': '8px',
    'style-radius-xl': '12px',
    'style-radius-2xl': '16px',
    'style-radius-3xl': '20px',
    'semantic-radius': '8px',
    'semantic-radius-sm': '4px',
    'semantic-radius-md': '6px',
    'semantic-radius-lg': '8px',
    'semantic-radius-xl': '12px',

    // ── Shadows (pure black; xs is none, layers separate via brightness) ──
    'style-shadow-xs': 'none',
    'style-shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -8px rgba(0, 0, 0, 0.5)',
    'style-shadow-md': '0 1px 2px rgba(0, 0, 0, 0.5), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
    'style-shadow-lg': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
    'style-shadow-xl': '0 20px 56px -12px rgba(0, 0, 0, 0.7)',
    'style-shadow-2xl': '0 24px 64px -16px rgba(0, 0, 0, 0.75)',
    'style-shadow-subtle': 'none',
    'style-shadow-card': 'none',
    'style-shadow-elevated': '0 8px 24px -8px rgba(0, 0, 0, 0.55)',
    'style-shadow-modal': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
    'style-shadow-popover': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
    'style-shadow-glow-accent': 'none',
    'style-shadow-inset': 'inset 0 1px 2px rgba(0, 0, 0, 0.4)',

    // ── Animation Easing ──
    'style-ease-smooth': 'cubic-bezier(0.2, 0, 0, 1)',

    // ── Switch Control ──
    'style-switch-width': '36px',
    'style-switch-height': '20px',
    'style-switch-thumb-size': '16px',
    'style-switch-width-sm': '28px',
    'style-switch-height-sm': '16px',
    'style-switch-thumb-size-sm': '12px',
    'style-switch-thumb-offset': '2px',
    'style-switch-hover-extend': '1px',
    'style-switch-press-extend': '2px',
    'style-switch-press-shrink': '1px',
    'style-switch-motion-ms': '150',
    'style-switch-thumb': '#FFFFFF',
    'style-work-chat-thumb-radius': '6px',
    'style-work-chat-thumb':
      'color-mix(in oklab, var(--zy-foreground) 26%, var(--zy-surface-raised))',
    'style-work-chat-track': 'rgba(255, 255, 255, 0.08)',

    // ── Brand (signal color: executable actions, focus, running) ──
    primary: '#4C8DFF',
    'primary-foreground': '#0F1013',
    'primary-hover': '#6FA4FF',
    'primary-muted': 'rgba(76, 141, 255, 0.16)',
    // Button-grade primary: deep enough for AA white text on filled buttons.
    'primary-strong': '#2E6DE6',
    'switch-thumb-foreground': '#4C8DFF',
    'switch-track-checked': '#4C8DFF',
    'switch-track-checked-hover': '#6FA4FF',

    // ── Surfaces (opaque, four fixed levels) ──
    background: '#17181C',
    foreground: '#EDEEF0',
    surface: '#0F1013',
    'surface-foreground': '#EDEEF0',
    'surface-raised': '#1E2025',
    'surface-tertiary': '#26282E',
    'surface-overlay': '#22252B',

    // ── Accent (neutral hover fill) ──
    accent: 'rgba(255, 255, 255, 0.05)',
    'accent-foreground': '#EDEEF0',

    // ── Chat Bubbles (assistant sits directly on the canvas) ──
    'chat-user': 'rgba(255, 255, 255, 0.08)',
    'chat-user-foreground': '#EDEEF0',
    'chat-bot': 'transparent',
    'chat-bot-foreground': '#EDEEF0',

    // ── Model Tags ──
    'model-tag-neutral-background': 'rgba(255, 255, 255, 0.07)',
    'model-tag-neutral-foreground': '#A8ADB7',
    'model-tag-neutral-border': 'rgba(255, 255, 255, 0.12)',
    'model-tag-violet-background': 'rgba(167, 139, 250, 0.15)',
    'model-tag-violet-foreground': '#A78BFA',
    'model-tag-violet-border': 'rgba(167, 139, 250, 0.35)',
    'model-tag-green-background': 'rgba(71, 205, 137, 0.15)',
    'model-tag-green-foreground': '#47CD89',
    'model-tag-green-border': 'rgba(71, 205, 137, 0.35)',

    // ── Skill Colors ──
    'skill-blue-background': 'rgba(76, 141, 255, 0.14)',
    'skill-blue-foreground': '#4C8DFF',

    // ── Text Hierarchy ──
    'text-primary': '#EDEEF0',
    'text-muted-foreground': '#A8ADB7',
    'text-muted': '#858B96',

    // ── Borders ──
    border: 'rgba(255, 255, 255, 0.07)',
    'border-subtle': 'rgba(255, 255, 255, 0.04)',
    'input-border': 'rgba(255, 255, 255, 0.13)',

    // ── Scrollbar ──
    'scroll-thumb': 'rgba(255, 255, 255, 0.14)',
    'scroll-thumb-hover': 'rgba(255, 255, 255, 0.24)',

    // ── Gradients (decorative gradients are retired in v4) ──
    'gradient-1': 'transparent',
    'gradient-2': 'transparent',

    // ── Status Colors ──
    destructive: '#F97066',
    'destructive-foreground': '#0F1013',
    'style-destructive-confirm': '#D92D20',
    success: '#47CD89',
    warning: '#FDB022',

    // ── Gray Scale (11 steps) ──
    'gray-1': '#0F172A',
    'gray-2': '#1E293B',
    'gray-3': '#334155',
    'gray-4': '#475569',
    'gray-5': '#64748B',
    'gray-6': '#94A3B8',
    'gray-7': '#CBD5E1',
    'gray-8': '#E2E8F0',
    'gray-9': '#F1F5F9',
    'gray-10': '#F8FAFC',
    'gray-11': '#FFFFFF',

    // ── Focus Ring ──
    ring: 'rgba(76, 141, 255, 0.5)',

    // ── Semantic Aliases ──
    'semantic-background': '#17181C',
    'semantic-foreground': '#EDEEF0',
    'semantic-card': '#1E2025',
    'semantic-card-foreground': '#EDEEF0',
    'semantic-popover': '#22252B',
    'semantic-popover-foreground': '#EDEEF0',
    'semantic-primary': '#4C8DFF',
    'semantic-primary-foreground': '#0F1013',
    'semantic-secondary': 'rgba(255, 255, 255, 0.07)',
    'semantic-secondary-foreground': '#EDEEF0',
    'semantic-muted': 'rgba(255, 255, 255, 0.06)',
    'semantic-muted-foreground': '#A8ADB7',
    'semantic-accent': 'rgba(255, 255, 255, 0.05)',
    'semantic-accent-foreground': '#EDEEF0',
    'semantic-destructive': '#F97066',
    'semantic-border': 'rgba(255, 255, 255, 0.07)',
    'semantic-input': 'rgba(255, 255, 255, 0.13)',
    'semantic-ring': 'rgba(76, 141, 255, 0.5)',

    // ── Charts ──
    'semantic-chart-1': '#4C8DFF',
    'semantic-chart-2': '#A78BFA',
    'semantic-chart-3': '#47CD89',
    'semantic-chart-4': '#FDB022',
    'semantic-chart-5': '#F97066',

    // ── Sidebar (sits directly on the window base) ──
    'semantic-sidebar': '#0F1013',
    'semantic-sidebar-foreground': '#EDEEF0',
    'semantic-sidebar-primary': '#4C8DFF',
    'semantic-sidebar-primary-foreground': '#0F1013',
    'semantic-sidebar-accent': 'rgba(255, 255, 255, 0.08)',
    'semantic-sidebar-accent-foreground': '#EDEEF0',
    'semantic-sidebar-border': 'rgba(255, 255, 255, 0.07)',
    'semantic-sidebar-ring': 'rgba(76, 141, 255, 0.5)',

    // ── Appearance-conditioned component values (work package N) — dark ──
    'state-destructive-tint-percent': '20%',
    'state-destructive-border': 'color-mix(in oklab, var(--destructive) 50%, transparent)',
    'state-destructive-focus-ring': '40%',
    'state-destructive-hover-tint-percent': '30%',
    'state-primary-border-tint-percent': '20%',
    'state-primary-fill-tint-percent': '10%',
    'state-input-tint-percent': '30%',
    'state-input-disabled-tint-percent': '80%',
    'state-input-solid': 'color-mix(in oklab, var(--input) 30%, transparent)',
    'state-input-hover': 'color-mix(in oklab, var(--input) 50%, transparent)',
    'state-muted-hover': 'color-mix(in oklab, var(--muted) 50%, transparent)',
    'state-avatar-blend': 'lighten',
    'state-input-border': 'var(--input)',
    'state-tab-selected-border': 'transparent',
    'state-input-field': 'color-mix(in oklab, var(--input) 30%, transparent)',
    'state-banner-destructive-bg': 'color-mix(in oklab, var(--zy-destructive) 16%, transparent)',
    'state-banner-destructive-border':
      'color-mix(in oklab, var(--zy-destructive) 40%, transparent)',
    'state-banner-destructive-text': 'var(--zy-destructive)',
    'state-banner-warning-bg': 'color-mix(in oklab, var(--zy-warning) 14%, transparent)',
    'state-banner-warning-border': 'color-mix(in oklab, var(--zy-warning) 35%, transparent)',
    'state-banner-warning-text': 'var(--zy-warning)',
    'state-login-hover-tint':
      'color-mix(in oklab, var(--zy-component-palette-white) 4%, transparent)',
    'state-muted-tab-text': 'var(--muted-foreground)',
    'state-page-pill-bg': 'var(--zy-background)',
    'state-page-pill-hover': 'var(--muted)',
    'state-session-tint': 'color-mix(in oklab, var(--zy-component-palette-white) 5%, transparent)',

    // ── Component Palettes ──
    'component-palette-white': '#FFFFFF',
    'component-palette-black': '#000000',
    'component-palette-blue-400': '#60A5FA',
    'component-palette-blue-500': '#3B82F6',
    'component-palette-blue-600': '#2563EB',
    'component-palette-green-400': '#34D399',
    'component-palette-green-500': '#10B981',
    'component-palette-green-600': '#059669',
    'component-palette-yellow-50': '#713F12',
    'component-palette-yellow-200': '#A16207',
    'component-palette-yellow-400': '#FACC15',
    'component-palette-yellow-500': '#EAB308',
    'component-palette-yellow-600': '#CA8A04',
    'component-palette-yellow-700': '#A16207',
    'component-palette-yellow-800': '#854D0E',
    'component-palette-yellow-900': '#713F12',
    'component-palette-amber-50': '#78350F',
    'component-palette-amber-200': '#B45309',
    'component-palette-amber-400': '#FBBF24',
    'component-palette-amber-500': '#F59E0B',
    'component-palette-amber-700': '#B45309',
    'component-palette-amber-800': '#92400E',
    'component-palette-amber-950': '#451A03',
    'component-palette-orange-500': '#F97316',
    'component-palette-orange-600': '#EA580C',
    'component-palette-red-50': '#7F1D1D',
    'component-palette-red-200': '#B91C1C',
    'component-palette-red-400': '#F87171',
    'component-palette-red-500': '#EF4444',
    'component-palette-red-600': '#DC2626',
    'component-palette-red-700': '#B91C1C',
    'component-palette-red-800': '#991B1B',
    'component-palette-red-900': '#7F1D1D',
    'component-palette-neutral-50': '#0A0A0A',
    'component-palette-neutral-200': '#404040',
    'component-palette-neutral-300': '#525252',
    'component-palette-neutral-600': '#A3A3A3',
    'component-palette-neutral-700': '#D4D4D4',
    'component-palette-neutral-800': '#E5E5E5',
    'component-palette-neutral-950': '#FAFAFA',
    'component-palette-gray-300': '#6B7280',
    'component-palette-gray-400': '#9CA3AF',
    'component-palette-gray-600': '#D1D5DB',
    'component-palette-zinc-100': '#27272A',
    'component-palette-zinc-400': '#A1A1AA',
    'component-palette-zinc-800': '#F4F4F5',
    'component-palette-zinc-950': '#FAFAFA',

    // ── Editor Colors ──
    'component-editor-background': '#17181C',
    'component-editor-foreground': '#EDEEF0',
    'component-editor-gutter': '#121317',
    'component-editor-selection': 'rgba(76, 141, 255, 0.22)',
    'component-editor-active-line': 'rgba(255, 255, 255, 0.05)',
    'component-editor-deleted': 'rgba(249, 112, 102, 0.15)',
    'component-editor-inserted': 'rgba(71, 205, 137, 0.15)',
    'component-editor-indent': 'rgba(255, 255, 255, 0.04)',
    'component-editor-indent-active': 'rgba(76, 141, 255, 0.22)',
    'component-editor-deleted-chunk': 'rgba(249, 112, 102, 0.12)',
    'component-editor-inserted-chunk': 'rgba(71, 205, 137, 0.12)',
    'component-editor-changed': 'rgba(253, 176, 34, 0.2)',
    'component-editor-search': 'rgba(253, 176, 34, 0.28)',
    'component-editor-search-selected': 'rgba(253, 176, 34, 0.45)',
    'component-editor-error': 'rgba(249, 112, 102, 0.2)',
    'component-editor-indent-fallback': 'rgba(255, 255, 255, 0.04)',
    'component-editor-indent-active-fallback': 'rgba(76, 141, 255, 0.16)',

    // ── Overlay ──
    'component-overlay-strong': 'rgba(0, 0, 0, 0.6)',

    // ── Diff Colors ──
    'component-diff-added': '#47CD89',
    'component-diff-removed': '#F97066',
    'component-diff-added-background': 'rgba(71, 205, 137, 0.15)',
    'component-diff-removed-background': 'rgba(249, 112, 102, 0.15)',

    // ── Component Misc ──
    'component-shimmer': 'rgba(255, 255, 255, 0.08)',

    // ── Syntax Highlighting (CodeMirror) ──
    'syntax-codemirror-0': '#17181C',
    'syntax-codemirror-6': '#858B96',
    'syntax-codemirror-7': '#4C8DFF',
    'syntax-codemirror-8': '#47CD89',
    'syntax-codemirror-9': '#A78BFA',
    'syntax-codemirror-10': '#FDB022',
    'syntax-codemirror-11': '#F97066',
    'syntax-codemirror-12': '#F472B6',
    'syntax-codemirror-13': '#22D3EE',
    'syntax-codemirror-14': '#A3E635',
    'syntax-codemirror-15': '#FB923C',
    'syntax-codemirror-16': '#C084FC',
    'syntax-codemirror-17': '#2DD4BF',
    'syntax-codemirror-18': '#FDBA74',

    // ── Syntax Highlighting (Shiki) ──
    'syntax-shiki-foreground': '#EDEEF0',
    'syntax-shiki-background': '#17181C',
    'syntax-shiki-token-comment': '#858B96',
    'syntax-shiki-token-keyword': '#A78BFA',
    'syntax-shiki-token-string': '#47CD89',
    'syntax-shiki-token-string-expression': '#34D399',
    'syntax-shiki-token-constant': '#FDB022',
    'syntax-shiki-token-parameter': '#4C8DFF',
    'syntax-shiki-token-function': '#22D3EE',
    'syntax-shiki-token-punctuation': '#A8ADB7',
    'syntax-shiki-token-link': '#6FA4FF',
    'syntax-shiki-ansi-black': '#101828',
    'syntax-shiki-ansi-bright-black': '#475467',
    'syntax-shiki-ansi-red': '#F97066',
    'syntax-shiki-ansi-bright-red': '#FDA29B',
    'syntax-shiki-ansi-green': '#47CD89',
    'syntax-shiki-ansi-bright-green': '#75E0A7',
    'syntax-shiki-ansi-yellow': '#FDB022',
    'syntax-shiki-ansi-bright-yellow': '#FEC84B',
    'syntax-shiki-ansi-blue': '#4C8DFF',
    'syntax-shiki-ansi-bright-blue': '#84ADFF',
    'syntax-shiki-ansi-magenta': '#A78BFA',
    'syntax-shiki-ansi-bright-magenta': '#C4B5FD',
    'syntax-shiki-ansi-cyan': '#22D3EE',
    'syntax-shiki-ansi-bright-cyan': '#67E8F9',
    'syntax-shiki-ansi-white': '#CBD5E1',
    'syntax-shiki-ansi-bright-white': '#F1F5F9',
  },
};
