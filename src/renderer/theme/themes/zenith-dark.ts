import { BackgroundKind, DEFAULT_BACKGROUND } from '../background/background';
import { classicComponentAppearances } from '../components/classic';
import type { ThemeDefinition } from './types';
import { quietStudioAppearances, quietStudioDarkTokens } from './quiet-studio-v4';

/**
 * Zenith Dark - Premium Futuristic Design
 *
 * Philosophy: 清新 (fresh) · 轻盈 (light/airy) · 畅快 (smooth, fluid) · 科技感 (tech-forward)
 * Features: Glassmorphism, generous spacing, fluid motion, luminous gradients
 */
export const zenithDark: ThemeDefinition = {
  meta: {
    id: 'zenith-dark',
    name: 'Zenith Dark',
    description: 'Premium futuristic dark theme with glassmorphism',
    appearance: 'dark',
  },
  components: { ...classicComponentAppearances(), ...quietStudioAppearances() },
  background: {
    ...DEFAULT_BACKGROUND,
    kind: BackgroundKind.Color,
    color: '#121316',
    opacity: 0,
  },
  tokens: {
    // ── Typography Scale (Desktop-optimized: light and dense) ──
    'component-text-xs': '11px',
    'component-text-xs--line-height': '16px',
    'component-text-sm': '12px',
    'component-text-sm--line-height': '18px',
    'component-text-base': '13px',
    'component-text-base--line-height': '20px',
    'component-text-lg': '15px',
    'component-text-lg--line-height': '22px',
    'component-text-xl': '17px',
    'component-text-xl--line-height': '24px',
    'component-text-2xl': '20px',
    'component-text-2xl--line-height': '28px',
    'component-text-3xl': '24px',
    'component-text-3xl--line-height': '32px',
    'component-text-4xl': '28px',
    'component-text-4xl--line-height': '36px',
    'component-text-5xl': '32px',
    'component-text-5xl--line-height': '40px',
    'component-text-6xl': '36px',
    'component-text-6xl--line-height': '44px',
    'component-text-7xl': '40px',
    'component-text-7xl--line-height': '48px',
    'component-text-8xl': '48px',
    'component-text-8xl--line-height': '56px',
    'component-text-9xl': '56px',
    'component-text-9xl--line-height': '64px',
    'style-text-xxl': '18px',
    'style-text-xxl--line-height': '26px',
    'style-body-leading': '1.5',

    // ── Font Weights ──
    'component-font-weight-normal': '400',
    'component-font-weight-medium': '500',
    'component-font-weight-semibold': '600',
    'component-font-weight-bold': '700',

    // ── Font Stacks ──
    'style-font-sans':
      "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    'style-font-mono':
      "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
    'style-font-heading':
      "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",

    // ── Border Radius (Larger, modern) ──
    radius: '12px',
    // Appearance-conditioned component values (work package N) — dark
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
    'style-radius-sm': '8px',
    'state-login-hover-tint':
      'color-mix(in oklab, var(--zy-component-palette-white) 4%, transparent)',
    'state-muted-tab-text': 'var(--muted-foreground)',
    'state-page-pill-bg': 'var(--zy-background)',
    'state-page-pill-hover': 'var(--muted)',
    'state-session-tint': 'color-mix(in oklab, var(--zy-component-palette-white) 5%, transparent)',
    'style-radius-md': '12px',
    'style-radius-lg': '16px',
    'style-radius-xl': '20px',
    'style-radius-2xl': '24px',
    'style-radius-3xl': '32px',
    'semantic-radius': '12px',
    'semantic-radius-sm': '8px',
    'semantic-radius-md': '12px',
    'semantic-radius-lg': '16px',
    'semantic-radius-xl': '20px',

    // ── Shadows (Multi-layer with colored glow) ──
    'style-shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'style-shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.5), 0 0 16px rgba(96, 165, 250, 0.08)',
    'style-shadow-md': '0 4px 12px rgba(0, 0, 0, 0.6), 0 0 24px rgba(96, 165, 250, 0.12)',
    'style-shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.7), 0 0 40px rgba(96, 165, 250, 0.16)',
    'style-shadow-xl': '0 12px 40px rgba(0, 0, 0, 0.8), 0 0 64px rgba(96, 165, 250, 0.24)',
    'style-shadow-2xl': '0 24px 80px rgba(0, 0, 0, 0.9), 0 0 96px rgba(96, 165, 250, 0.20)',
    'style-shadow-subtle': '0 1px 3px rgba(0, 0, 0, 0.5)',
    'style-shadow-card': '0 4px 12px rgba(0, 0, 0, 0.6), 0 0 24px rgba(96, 165, 250, 0.12)',
    'style-shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.7), 0 0 40px rgba(96, 165, 250, 0.16)',
    'style-shadow-modal': '0 24px 80px rgba(0, 0, 0, 0.9), 0 0 96px rgba(96, 165, 250, 0.20)',
    'style-shadow-popover': '0 12px 40px rgba(0, 0, 0, 0.8), 0 0 64px rgba(96, 165, 250, 0.24)',
    'style-shadow-glow-accent': '0 0 48px rgba(96, 165, 250, 0.4)',
    'style-shadow-inset': 'inset 0 2px 4px rgba(0, 0, 0, 0.3)',

    // ── Animation Easing ──
    'style-ease-smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',

    // ── Switch Control (Compact) ──
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
    'style-work-chat-thumb-radius': '8px',
    'style-work-chat-thumb': 'color-mix(in oklab, var(--zy-foreground) 20%, var(--zy-background))',
    'style-work-chat-track': 'rgba(96, 165, 250, 0.12)',

    // ── Brand Colors (Gradient primary) ──
    primary: '#60A5FA',
    'primary-foreground': '#0A0E1A',
    'primary-hover': '#3B82F6',
    'primary-muted': 'rgba(96, 165, 250, 0.15)',
    'primary-strong': '#3B82F6',
    'switch-thumb-foreground': '#60A5FA',
    'switch-track-checked': '#60A5FA',
    'switch-track-checked-hover': '#3B82F6',

    // ── Surfaces (Glassmorphic) ──
    background: '#0A0E1A',
    foreground: '#E8EBF0',
    surface: 'rgba(20, 24, 36, 0.85)',
    'surface-foreground': '#E8EBF0',
    'surface-raised': 'rgba(30, 35, 50, 0.90)',
    'surface-tertiary': 'rgba(25, 30, 45, 0.88)',
    'surface-overlay': 'rgba(30, 35, 50, 0.98)',

    // ── Accent ──
    accent: 'rgba(96, 165, 250, 0.12)',
    'accent-foreground': '#60A5FA',

    // ── Chat Bubbles ──
    'chat-user': 'rgba(96, 165, 250, 0.12)',
    'chat-user-foreground': '#E8EBF0',
    'chat-bot': 'rgba(20, 24, 36, 0.85)',
    'chat-bot-foreground': '#E8EBF0',

    // ── Model Tags ──
    'model-tag-neutral-background': 'rgba(71, 85, 105, 0.3)',
    'model-tag-neutral-foreground': '#CBD5E1',
    'model-tag-neutral-border': 'rgba(100, 116, 139, 0.4)',
    'model-tag-violet-background': 'rgba(167, 139, 250, 0.15)',
    'model-tag-violet-foreground': '#A78BFA',
    'model-tag-violet-border': 'rgba(167, 139, 250, 0.35)',
    'model-tag-green-background': 'rgba(52, 211, 153, 0.15)',
    'model-tag-green-foreground': '#34D399',
    'model-tag-green-border': 'rgba(52, 211, 153, 0.35)',

    // ── Skill Colors ──
    'skill-blue-background': 'rgba(96, 165, 250, 0.12)',
    'skill-blue-foreground': '#60A5FA',

    // ── Text Hierarchy ──
    'text-primary': '#E8EBF0',
    'text-muted-foreground': '#A0AEC0',
    'text-muted': '#4A5568',

    // ── Borders ──
    border: 'rgba(255, 255, 255, 0.08)',
    'border-subtle': 'rgba(255, 255, 255, 0.04)',
    'input-border': 'rgba(255, 255, 255, 0.10)',

    // ── Scrollbar ──
    'scroll-thumb': 'rgba(255, 255, 255, 0.12)',
    'scroll-thumb-hover': 'rgba(255, 255, 255, 0.20)',

    // ── Gradients ──
    'gradient-1': 'rgba(96, 165, 250, 0.08)',
    'gradient-2': 'rgba(167, 139, 250, 0.08)',

    // ── Status Colors ──
    destructive: '#F87171',
    'destructive-foreground': '#0A0E1A',
    'style-destructive-confirm': '#EF4444',
    success: '#34D399',
    warning: '#FBBF24',

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
    ring: '#60A5FA',

    // ── Semantic Aliases ──
    'semantic-background': '#0A0E1A',
    'semantic-foreground': '#E8EBF0',
    'semantic-card': 'rgba(20, 24, 36, 0.85)',
    'semantic-card-foreground': '#E8EBF0',
    'semantic-popover': 'rgba(30, 35, 50, 0.98)',
    'semantic-popover-foreground': '#E8EBF0',
    'semantic-primary': '#60A5FA',
    'semantic-primary-foreground': '#0A0E1A',
    'semantic-secondary': 'rgba(30, 35, 50, 0.90)',
    'semantic-secondary-foreground': '#E8EBF0',
    'semantic-muted': 'rgba(30, 35, 50, 0.90)',
    'semantic-muted-foreground': '#A0AEC0',
    'semantic-accent': 'rgba(96, 165, 250, 0.12)',
    'semantic-accent-foreground': '#60A5FA',
    'semantic-destructive': '#F87171',
    'semantic-border': 'rgba(255, 255, 255, 0.08)',
    'semantic-input': 'rgba(255, 255, 255, 0.10)',
    'semantic-ring': '#60A5FA',

    // ── Charts ──
    'semantic-chart-1': '#60A5FA',
    'semantic-chart-2': '#A78BFA',
    'semantic-chart-3': '#34D399',
    'semantic-chart-4': '#FBBF24',
    'semantic-chart-5': '#F87171',

    // ── Sidebar ──
    'semantic-sidebar': 'rgba(20, 24, 36, 0.85)',
    'semantic-sidebar-foreground': '#E8EBF0',
    'semantic-sidebar-primary': '#60A5FA',
    'semantic-sidebar-primary-foreground': '#0A0E1A',
    'semantic-sidebar-accent': 'rgba(96, 165, 250, 0.12)',
    'semantic-sidebar-accent-foreground': '#60A5FA',
    'semantic-sidebar-border': 'rgba(255, 255, 255, 0.08)',
    'semantic-sidebar-ring': '#60A5FA',

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
    'component-editor-background': 'rgba(15, 20, 30, 0.95)',
    'component-editor-foreground': '#E8EBF0',
    'component-editor-gutter': 'rgba(20, 24, 36, 0.8)',
    'component-editor-selection': 'rgba(96, 165, 250, 0.20)',
    'component-editor-active-line': 'rgba(96, 165, 250, 0.08)',
    'component-editor-deleted': 'rgba(248, 113, 113, 0.15)',
    'component-editor-inserted': 'rgba(52, 211, 153, 0.15)',
    'component-editor-indent': 'rgba(255, 255, 255, 0.04)',
    'component-editor-indent-active': 'rgba(96, 165, 250, 0.20)',
    'component-editor-deleted-chunk': 'rgba(248, 113, 113, 0.12)',
    'component-editor-inserted-chunk': 'rgba(52, 211, 153, 0.12)',
    'component-editor-changed': 'rgba(251, 191, 36, 0.20)',
    'component-editor-search': 'rgba(251, 191, 36, 0.30)',
    'component-editor-search-selected': 'rgba(251, 191, 36, 0.45)',
    'component-editor-error': 'rgba(248, 113, 113, 0.20)',
    'component-editor-indent-fallback': 'rgba(255, 255, 255, 0.04)',
    'component-editor-indent-active-fallback': 'rgba(96, 165, 250, 0.15)',

    // ── Overlay ──
    'component-overlay-strong': 'rgba(10, 14, 26, 0.6)',

    // ── Diff Colors ──
    'component-diff-added': '#34D399',
    'component-diff-removed': '#F87171',
    'component-diff-added-background': 'rgba(52, 211, 153, 0.15)',
    'component-diff-removed-background': 'rgba(248, 113, 113, 0.15)',

    // ── Component Misc ──
    'component-shimmer': 'rgba(96, 165, 250, 0.15)',

    // ── Syntax Highlighting (CodeMirror) ──
    'syntax-codemirror-0': 'rgba(15, 20, 30, 0.95)',
    'syntax-codemirror-6': '#94A3B8',
    'syntax-codemirror-7': '#60A5FA',
    'syntax-codemirror-8': '#34D399',
    'syntax-codemirror-9': '#A78BFA',
    'syntax-codemirror-10': '#FBBF24',
    'syntax-codemirror-11': '#F87171',
    'syntax-codemirror-12': '#F472B6',
    'syntax-codemirror-13': '#22D3EE',
    'syntax-codemirror-14': '#A3E635',
    'syntax-codemirror-15': '#FB923C',
    'syntax-codemirror-16': '#C084FC',
    'syntax-codemirror-17': '#2DD4BF',
    'syntax-codemirror-18': '#FDBA74',

    // ── Syntax Highlighting (Shiki) ──
    'syntax-shiki-foreground': '#E8EBF0',
    'syntax-shiki-background': 'rgba(15, 20, 30, 0.95)',
    'syntax-shiki-token-comment': '#94A3B8',
    'syntax-shiki-token-keyword': '#A78BFA',
    'syntax-shiki-token-string': '#34D399',
    'syntax-shiki-token-string-expression': '#10B981',
    'syntax-shiki-token-constant': '#FBBF24',
    'syntax-shiki-token-parameter': '#60A5FA',
    'syntax-shiki-token-function': '#22D3EE',
    'syntax-shiki-token-punctuation': '#CBD5E1',
    'syntax-shiki-token-link': '#3B82F6',
    'syntax-shiki-ansi-black': '#0F172A',
    'syntax-shiki-ansi-bright-black': '#475569',
    'syntax-shiki-ansi-red': '#F87171',
    'syntax-shiki-ansi-bright-red': '#FCA5A5',
    'syntax-shiki-ansi-green': '#34D399',
    'syntax-shiki-ansi-bright-green': '#6EE7B7',
    'syntax-shiki-ansi-yellow': '#FBBF24',
    'syntax-shiki-ansi-bright-yellow': '#FDE047',
    'syntax-shiki-ansi-blue': '#60A5FA',
    'syntax-shiki-ansi-bright-blue': '#93C5FD',
    'syntax-shiki-ansi-magenta': '#A78BFA',
    'syntax-shiki-ansi-bright-magenta': '#C4B5FD',
    'syntax-shiki-ansi-cyan': '#22D3EE',
    'syntax-shiki-ansi-bright-cyan': '#67E8F9',
    'syntax-shiki-ansi-white': '#CBD5E1',
    'syntax-shiki-ansi-bright-white': '#F1F5F9',

    // ── v4.0 Quiet Studio overrides ──
    ...quietStudioDarkTokens,
  },
};
