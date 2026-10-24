import { BackgroundKind, DEFAULT_BACKGROUND } from '../background/background';
import { classicComponentAppearances } from '../components/classic';
import { withAccessibleComposer } from '../components/accessible-composer';
import type { ThemeDefinition } from './types';
import { quietStudioAppearances, quietStudioLightTokens } from './quiet-studio-v4';

/**
 * Zenith Light - Premium Futuristic Design
 *
 * Philosophy: 清新 (fresh) · 轻盈 (light/airy) · 畅快 (smooth, fluid) · 科技感 (tech-forward)
 * Features: Glassmorphism, generous spacing, fluid motion, luminous gradients
 */
export const zenithLight: ThemeDefinition = {
  meta: {
    id: 'zenith-light',
    name: 'Zenith Light',
    description: 'Premium futuristic light theme with glassmorphism',
    appearance: 'light',
  },
  components: withAccessibleComposer({
    ...classicComponentAppearances(),
    ...quietStudioAppearances(),
  }),
  background: {
    ...DEFAULT_BACKGROUND,
    kind: BackgroundKind.Color,
    color: '#F4F5F7',
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
    // Appearance-conditioned component values (work package N) — light
    'state-destructive-tint-percent': '10%',
    'state-destructive-border': 'var(--destructive)',
    'state-destructive-focus-ring': '20%',
    'state-destructive-hover-tint-percent': '20%',
    'state-primary-border-tint-percent': '30%',
    'state-primary-fill-tint-percent': '5%',
    'state-input-tint-percent': '50%',
    'state-input-disabled-tint-percent': '50%',
    'state-input-solid': 'var(--zy-surface)',
    'state-input-hover': 'var(--muted)',
    'state-muted-hover': 'var(--muted)',
    'state-avatar-blend': 'darken',
    'state-input-border': 'var(--border)',
    'state-tab-selected-border': 'var(--input)',
    'state-input-field': 'transparent',
    'state-banner-destructive-bg': 'color-mix(in oklab, var(--zy-destructive) 8%, transparent)',
    'state-banner-destructive-border':
      'color-mix(in oklab, var(--zy-destructive) 25%, transparent)',
    'state-banner-destructive-text':
      'color-mix(in oklab, var(--zy-destructive) 70%, var(--zy-component-palette-black))',
    'state-banner-warning-bg': 'color-mix(in oklab, var(--zy-warning) 10%, transparent)',
    'state-banner-warning-border': 'color-mix(in oklab, var(--zy-warning) 30%, transparent)',
    'state-banner-warning-text':
      'color-mix(in oklab, var(--zy-warning) 60%, var(--zy-component-palette-black))',
    'style-radius-sm': '8px',
    'state-login-hover-tint':
      'color-mix(in oklab, var(--zy-component-palette-black) 3%, transparent)',
    'state-muted-tab-text': 'color-mix(in oklab, var(--foreground) 60%, transparent)',
    'state-page-pill-bg': 'transparent',
    'state-page-pill-hover': 'var(--muted)',
    'state-session-tint': 'color-mix(in oklab, var(--zy-component-palette-black) 4%, transparent)',
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
    'style-shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
    'style-shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.06), 0 0 12px rgba(59, 130, 246, 0.04)',
    'style-shadow-md': '0 4px 12px rgba(0, 0, 0, 0.08), 0 0 20px rgba(59, 130, 246, 0.08)',
    'style-shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.10), 0 0 32px rgba(59, 130, 246, 0.12)',
    'style-shadow-xl': '0 12px 40px rgba(0, 0, 0, 0.12), 0 0 48px rgba(59, 130, 246, 0.18)',
    'style-shadow-2xl': '0 24px 80px rgba(0, 0, 0, 0.15), 0 0 64px rgba(59, 130, 246, 0.12)',
    'style-shadow-subtle': '0 1px 3px rgba(0, 0, 0, 0.06)',
    'style-shadow-card': '0 4px 12px rgba(0, 0, 0, 0.08), 0 0 20px rgba(59, 130, 246, 0.08)',
    'style-shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.10), 0 0 32px rgba(59, 130, 246, 0.12)',
    'style-shadow-modal': '0 24px 80px rgba(0, 0, 0, 0.15), 0 0 64px rgba(59, 130, 246, 0.12)',
    'style-shadow-popover': '0 12px 40px rgba(0, 0, 0, 0.12), 0 0 48px rgba(59, 130, 246, 0.18)',
    'style-shadow-glow-accent': '0 0 32px rgba(59, 130, 246, 0.3)',
    'style-shadow-inset': 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',

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
    'style-switch-thumb': '#ffffff',
    'style-work-chat-thumb-radius': '8px',
    'style-work-chat-thumb': 'rgba(255, 255, 255, 0.95)',
    'style-work-chat-track': 'rgba(59, 130, 246, 0.08)',

    // ── Brand Colors (Gradient primary) ──
    primary: '#3B82F6',
    'primary-foreground': '#FFFFFF',
    'primary-hover': '#2563EB',
    'primary-muted': 'rgba(59, 130, 246, 0.1)',
    'primary-strong': '#3B82F6',
    'switch-thumb-foreground': '#3B82F6',
    'switch-track-checked': '#3B82F6',
    'switch-track-checked-hover': '#2563EB',

    // ── Surfaces (Glassmorphic) ──
    background: '#FAFBFD',
    foreground: '#0A1628',
    surface: 'rgba(255, 255, 255, 0.85)',
    'surface-foreground': '#0A1628',
    'surface-raised': 'rgba(255, 255, 255, 0.95)',
    'surface-tertiary': 'rgba(248, 250, 252, 0.9)',
    'surface-overlay': 'rgba(255, 255, 255, 0.98)',

    // ── Accent ──
    accent: 'rgba(59, 130, 246, 0.08)',
    'accent-foreground': '#3B82F6',

    // ── Chat Bubbles ──
    'chat-user': 'rgba(59, 130, 246, 0.08)',
    'chat-user-foreground': '#0A1628',
    'chat-bot': 'rgba(255, 255, 255, 0.85)',
    'chat-bot-foreground': '#0A1628',

    // ── Model Tags ──
    'model-tag-neutral-background': 'rgba(226, 232, 240, 0.5)',
    'model-tag-neutral-foreground': '#475569',
    'model-tag-neutral-border': 'rgba(203, 213, 225, 0.6)',
    'model-tag-violet-background': 'rgba(139, 92, 246, 0.1)',
    'model-tag-violet-foreground': '#7C3AED',
    'model-tag-violet-border': 'rgba(139, 92, 246, 0.3)',
    'model-tag-green-background': 'rgba(16, 185, 129, 0.1)',
    'model-tag-green-foreground': '#059669',
    'model-tag-green-border': 'rgba(16, 185, 129, 0.3)',

    // ── Skill Colors ──
    'skill-blue-background': 'rgba(59, 130, 246, 0.08)',
    'skill-blue-foreground': '#3B82F6',

    // ── Text Hierarchy ──
    'text-primary': '#0A1628',
    'text-muted-foreground': '#4A5568',
    'text-muted': '#A0AEC0',

    // ── Borders ──
    border: 'rgba(0, 0, 0, 0.06)',
    'border-subtle': 'rgba(0, 0, 0, 0.03)',
    'input-border': 'rgba(0, 0, 0, 0.08)',

    // ── Scrollbar ──
    'scroll-thumb': 'rgba(0, 0, 0, 0.15)',
    'scroll-thumb-hover': 'rgba(0, 0, 0, 0.25)',

    // ── Gradients ──
    'gradient-1': 'rgba(59, 130, 246, 0.05)',
    'gradient-2': 'rgba(139, 92, 246, 0.05)',

    // ── Status Colors ──
    destructive: '#EF4444',
    'destructive-foreground': '#FFFFFF',
    'style-destructive-confirm': '#DC2626',
    success: '#10B981',
    warning: '#F59E0B',

    // ── Gray Scale (11 steps) ──
    'gray-1': '#FFFFFF',
    'gray-2': '#F8FAFC',
    'gray-3': '#F1F5F9',
    'gray-4': '#E2E8F0',
    'gray-5': '#CBD5E1',
    'gray-6': '#94A3B8',
    'gray-7': '#64748B',
    'gray-8': '#475569',
    'gray-9': '#334155',
    'gray-10': '#1E293B',
    'gray-11': '#0F172A',

    // ── Focus Ring ──

    // ── Semantic Aliases ──
    'semantic-background': '#FAFBFD',
    'semantic-foreground': '#0A1628',
    'semantic-card': 'rgba(255, 255, 255, 0.85)',
    'semantic-card-foreground': '#0A1628',
    'semantic-popover': 'rgba(255, 255, 255, 0.98)',
    'semantic-popover-foreground': '#0A1628',
    'semantic-primary': '#3B82F6',
    'semantic-primary-foreground': '#FFFFFF',
    'semantic-secondary': 'rgba(241, 245, 249, 0.9)',
    'semantic-secondary-foreground': '#0A1628',
    'semantic-muted': 'rgba(241, 245, 249, 0.9)',
    'semantic-muted-foreground': '#4A5568',
    'semantic-accent': 'rgba(59, 130, 246, 0.08)',
    'semantic-accent-foreground': '#3B82F6',
    'semantic-destructive': '#EF4444',
    'semantic-border': 'rgba(0, 0, 0, 0.06)',
    'semantic-input': 'rgba(0, 0, 0, 0.08)',

    // ── Charts ──
    'semantic-chart-1': '#3B82F6',
    'semantic-chart-2': '#8B5CF6',
    'semantic-chart-3': '#10B981',
    'semantic-chart-4': '#F59E0B',
    'semantic-chart-5': '#EF4444',

    // ── Sidebar ──
    'semantic-sidebar': 'rgba(255, 255, 255, 0.85)',
    'semantic-sidebar-foreground': '#0A1628',
    'semantic-sidebar-primary': '#3B82F6',
    'semantic-sidebar-primary-foreground': '#FFFFFF',
    'semantic-sidebar-accent': 'rgba(59, 130, 246, 0.08)',
    'semantic-sidebar-accent-foreground': '#3B82F6',
    'semantic-sidebar-border': 'rgba(0, 0, 0, 0.06)',

    // ── Component Palettes ──
    'component-palette-white': '#FFFFFF',
    'component-palette-black': '#000000',
    'component-palette-blue-400': '#60A5FA',
    'component-palette-blue-500': '#3B82F6',
    'component-palette-blue-600': '#2563EB',
    'component-palette-green-400': '#34D399',
    'component-palette-green-500': '#10B981',
    'component-palette-green-600': '#059669',
    'component-palette-yellow-50': '#FEFCE8',
    'component-palette-yellow-200': '#FEF08A',
    'component-palette-yellow-400': '#FACC15',
    'component-palette-yellow-500': '#EAB308',
    'component-palette-yellow-600': '#CA8A04',
    'component-palette-yellow-700': '#A16207',
    'component-palette-yellow-800': '#854D0E',
    'component-palette-yellow-900': '#713F12',
    'component-palette-amber-50': '#FFFBEB',
    'component-palette-amber-200': '#FDE68A',
    'component-palette-amber-400': '#FBBF24',
    'component-palette-amber-500': '#F59E0B',
    'component-palette-amber-700': '#B45309',
    'component-palette-amber-800': '#92400E',
    'component-palette-amber-950': '#451A03',
    'component-palette-orange-500': '#F97316',
    'component-palette-orange-600': '#EA580C',
    'component-palette-red-50': '#FEF2F2',
    'component-palette-red-200': '#FECACA',
    'component-palette-red-400': '#F87171',
    'component-palette-red-500': '#EF4444',
    'component-palette-red-600': '#DC2626',
    'component-palette-red-700': '#B91C1C',
    'component-palette-red-800': '#991B1B',
    'component-palette-red-900': '#7F1D1D',
    'component-palette-neutral-50': '#FAFAFA',
    'component-palette-neutral-200': '#E5E5E5',
    'component-palette-neutral-300': '#D4D4D4',
    'component-palette-neutral-600': '#525252',
    'component-palette-neutral-700': '#404040',
    'component-palette-neutral-800': '#262626',
    'component-palette-neutral-950': '#0A0A0A',
    'component-palette-gray-300': '#D1D5DB',
    'component-palette-gray-400': '#9CA3AF',
    'component-palette-gray-600': '#4B5563',
    'component-palette-zinc-100': '#F4F4F5',
    'component-palette-zinc-400': '#A1A1AA',
    'component-palette-zinc-800': '#27272A',
    'component-palette-zinc-950': '#09090B',

    // ── Editor Colors ──
    'component-editor-background': 'rgba(255, 255, 255, 0.95)',
    'component-editor-foreground': '#0A1628',
    'component-editor-gutter': 'rgba(248, 250, 252, 0.8)',
    'component-editor-selection': 'rgba(59, 130, 246, 0.15)',
    'component-editor-active-line': 'rgba(59, 130, 246, 0.05)',
    'component-editor-deleted': 'rgba(239, 68, 68, 0.1)',
    'component-editor-inserted': 'rgba(16, 185, 129, 0.1)',
    'component-editor-indent': 'rgba(0, 0, 0, 0.03)',
    'component-editor-indent-active': 'rgba(59, 130, 246, 0.15)',
    'component-editor-deleted-chunk': 'rgba(239, 68, 68, 0.08)',
    'component-editor-inserted-chunk': 'rgba(16, 185, 129, 0.08)',
    'component-editor-changed': 'rgba(245, 158, 11, 0.15)',
    'component-editor-search': 'rgba(245, 158, 11, 0.25)',
    'component-editor-search-selected': 'rgba(245, 158, 11, 0.4)',
    'component-editor-error': 'rgba(239, 68, 68, 0.15)',
    'component-editor-indent-fallback': 'rgba(0, 0, 0, 0.03)',
    'component-editor-indent-active-fallback': 'rgba(59, 130, 246, 0.1)',

    // ── Overlay ──
    'component-overlay-strong': 'rgba(10, 22, 40, 0.4)',

    // ── Diff Colors ──
    'component-diff-added': '#10B981',
    'component-diff-removed': '#EF4444',
    'component-diff-added-background': 'rgba(16, 185, 129, 0.1)',
    'component-diff-removed-background': 'rgba(239, 68, 68, 0.1)',

    // ── Component Misc ──
    'component-shimmer': 'rgba(59, 130, 246, 0.1)',

    // ── Syntax Highlighting (CodeMirror) ──
    'syntax-codemirror-0': 'rgba(255, 255, 255, 0.95)',
    'syntax-codemirror-6': '#64748B',
    'syntax-codemirror-7': '#3B82F6',
    'syntax-codemirror-8': '#10B981',
    'syntax-codemirror-9': '#8B5CF6',
    'syntax-codemirror-10': '#F59E0B',
    'syntax-codemirror-11': '#EF4444',
    'syntax-codemirror-12': '#EC4899',
    'syntax-codemirror-13': '#06B6D4',
    'syntax-codemirror-14': '#84CC16',
    'syntax-codemirror-15': '#F97316',
    'syntax-codemirror-16': '#A855F7',
    'syntax-codemirror-17': '#14B8A6',
    'syntax-codemirror-18': '#FB923C',

    // ── Syntax Highlighting (Shiki) ──
    'syntax-shiki-foreground': '#0A1628',
    'syntax-shiki-background': 'rgba(255, 255, 255, 0.95)',
    'syntax-shiki-token-comment': '#64748B',
    'syntax-shiki-token-keyword': '#8B5CF6',
    'syntax-shiki-token-string': '#10B981',
    'syntax-shiki-token-string-expression': '#059669',
    'syntax-shiki-token-constant': '#F59E0B',
    'syntax-shiki-token-parameter': '#3B82F6',
    'syntax-shiki-token-function': '#06B6D4',
    'syntax-shiki-token-punctuation': '#475569',
    'syntax-shiki-token-link': '#2563EB',
    'syntax-shiki-ansi-black': '#0F172A',
    'syntax-shiki-ansi-bright-black': '#475569',
    'syntax-shiki-ansi-red': '#EF4444',
    'syntax-shiki-ansi-bright-red': '#F87171',
    'syntax-shiki-ansi-green': '#10B981',
    'syntax-shiki-ansi-bright-green': '#34D399',
    'syntax-shiki-ansi-yellow': '#F59E0B',
    'syntax-shiki-ansi-bright-yellow': '#FBBF24',
    'syntax-shiki-ansi-blue': '#3B82F6',
    'syntax-shiki-ansi-bright-blue': '#60A5FA',
    'syntax-shiki-ansi-magenta': '#8B5CF6',
    'syntax-shiki-ansi-bright-magenta': '#A78BFA',
    'syntax-shiki-ansi-cyan': '#06B6D4',
    'syntax-shiki-ansi-bright-cyan': '#22D3EE',
    'syntax-shiki-ansi-white': '#E2E8F0',
    'syntax-shiki-ansi-bright-white': '#F8FAFC',

    // ── v4.0 Quiet Studio overrides ──
    ...quietStudioLightTokens,
    ring: 'var(--zy-primary)',
    'semantic-ring': 'var(--zy-primary)',
    'semantic-sidebar-ring': 'var(--zy-primary)',
  },
};
