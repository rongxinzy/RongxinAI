import { BackgroundKind, DEFAULT_BACKGROUND } from '../background/background';
import { classicComponentAppearances } from '../components/classic';
import type { ThemeDefinition } from './types';

/**
 * Zenith Light — DESIGN.md v4 "Quiet Studio".
 *
 * Neutral gray scale carries the interface; brand blue is a signal reserved
 * for executable primary actions, focus and running state. Opaque surfaces,
 * gray-only shadows, six-step type scale (12/14/16/18/20/24).
 */
export const zenithLight: ThemeDefinition = {
  meta: {
    id: 'zenith-light',
    name: 'Zenith Light',
    description: 'Quiet Studio light theme: neutral hierarchy, brand blue for action only',
    appearance: 'light',
  },
  components: classicComponentAppearances(),
  background: {
    ...DEFAULT_BACKGROUND,
    kind: BackgroundKind.Color,
    color: '#F4F5F7',
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

    // ── Shadows (gray only; no colored glow) ──
    'style-shadow-xs': '0 1px 2px rgba(16, 24, 40, 0.05)',
    'style-shadow-sm': '0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px -8px rgba(16, 24, 40, 0.08)',
    'style-shadow-md': '0 1px 2px rgba(16, 24, 40, 0.05), 0 12px 32px -8px rgba(16, 24, 40, 0.14)',
    'style-shadow-lg': '0 16px 48px -12px rgba(16, 24, 40, 0.18)',
    'style-shadow-xl': '0 20px 56px -12px rgba(16, 24, 40, 0.2)',
    'style-shadow-2xl': '0 24px 64px -16px rgba(16, 24, 40, 0.24)',
    'style-shadow-subtle': '0 1px 2px rgba(16, 24, 40, 0.05)',
    'style-shadow-card': 'none',
    'style-shadow-elevated': '0 8px 24px -8px rgba(16, 24, 40, 0.12)',
    'style-shadow-modal': '0 16px 48px -12px rgba(16, 24, 40, 0.18)',
    'style-shadow-popover': '0 16px 48px -12px rgba(16, 24, 40, 0.18)',
    'style-shadow-glow-accent': 'none',
    'style-shadow-inset': 'inset 0 1px 2px rgba(16, 24, 40, 0.05)',

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
    'style-work-chat-thumb': '#FFFFFF',
    'style-work-chat-track': 'rgba(16, 24, 40, 0.08)',

    // ── Brand (signal color: executable actions, focus, running) ──
    primary: '#0F6BF2',
    'primary-foreground': '#FFFFFF',
    'primary-hover': '#0C5FD9',
    'primary-muted': 'rgba(15, 107, 242, 0.1)',
    'primary-strong': '#0F6BF2',
    'switch-thumb-foreground': '#0F6BF2',
    'switch-track-checked': '#0F6BF2',
    'switch-track-checked-hover': '#0C5FD9',

    // ── Surfaces (opaque, four fixed levels) ──
    background: '#FFFFFF',
    foreground: '#101828',
    surface: '#F4F5F7',
    'surface-foreground': '#101828',
    'surface-raised': '#FFFFFF',
    'surface-tertiary': '#F0F1F4',
    'surface-overlay': '#FFFFFF',

    // ── Accent (neutral hover fill) ──
    accent: 'rgba(16, 24, 40, 0.05)',
    'accent-foreground': '#101828',

    // ── Chat Bubbles (assistant sits directly on the canvas) ──
    'chat-user': 'rgba(16, 24, 40, 0.06)',
    'chat-user-foreground': '#101828',
    'chat-bot': 'transparent',
    'chat-bot-foreground': '#101828',

    // ── Model Tags ──
    'model-tag-neutral-background': 'rgba(16, 24, 40, 0.05)',
    'model-tag-neutral-foreground': '#475467',
    'model-tag-neutral-border': 'rgba(16, 24, 40, 0.1)',
    'model-tag-violet-background': 'rgba(139, 92, 246, 0.1)',
    'model-tag-violet-foreground': '#7C3AED',
    'model-tag-violet-border': 'rgba(139, 92, 246, 0.3)',
    'model-tag-green-background': 'rgba(7, 148, 85, 0.1)',
    'model-tag-green-foreground': '#079455',
    'model-tag-green-border': 'rgba(7, 148, 85, 0.3)',

    // ── Skill Colors ──
    'skill-blue-background': 'rgba(15, 107, 242, 0.08)',
    'skill-blue-foreground': '#0F6BF2',

    // ── Text Hierarchy ──
    'text-primary': '#101828',
    'text-muted-foreground': '#475467',
    'text-muted': '#667085',

    // ── Borders ──
    border: 'rgba(16, 24, 40, 0.08)',
    'border-subtle': 'rgba(16, 24, 40, 0.04)',
    'input-border': 'rgba(16, 24, 40, 0.14)',

    // ── Scrollbar ──
    'scroll-thumb': 'rgba(16, 24, 40, 0.18)',
    'scroll-thumb-hover': 'rgba(16, 24, 40, 0.28)',

    // ── Gradients (decorative gradients are retired in v4) ──
    'gradient-1': 'transparent',
    'gradient-2': 'transparent',

    // ── Status Colors ──
    destructive: '#D92D20',
    'destructive-foreground': '#FFFFFF',
    'style-destructive-confirm': '#D92D20',
    success: '#079455',
    warning: '#DC6803',

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
    ring: 'rgba(15, 107, 242, 0.4)',

    // ── Semantic Aliases ──
    'semantic-background': '#FFFFFF',
    'semantic-foreground': '#101828',
    'semantic-card': '#FFFFFF',
    'semantic-card-foreground': '#101828',
    'semantic-popover': '#FFFFFF',
    'semantic-popover-foreground': '#101828',
    'semantic-primary': '#0F6BF2',
    'semantic-primary-foreground': '#FFFFFF',
    'semantic-secondary': 'rgba(16, 24, 40, 0.05)',
    'semantic-secondary-foreground': '#101828',
    'semantic-muted': 'rgba(16, 24, 40, 0.05)',
    'semantic-muted-foreground': '#475467',
    'semantic-accent': 'rgba(16, 24, 40, 0.05)',
    'semantic-accent-foreground': '#101828',
    'semantic-destructive': '#D92D20',
    'semantic-border': 'rgba(16, 24, 40, 0.08)',
    'semantic-input': 'rgba(16, 24, 40, 0.14)',
    'semantic-ring': 'rgba(15, 107, 242, 0.4)',

    // ── Charts ──
    'semantic-chart-1': '#0F6BF2',
    'semantic-chart-2': '#7C3AED',
    'semantic-chart-3': '#079455',
    'semantic-chart-4': '#DC6803',
    'semantic-chart-5': '#D92D20',

    // ── Sidebar (sits directly on the window base) ──
    'semantic-sidebar': '#F4F5F7',
    'semantic-sidebar-foreground': '#101828',
    'semantic-sidebar-primary': '#0F6BF2',
    'semantic-sidebar-primary-foreground': '#FFFFFF',
    'semantic-sidebar-accent': 'rgba(16, 24, 40, 0.08)',
    'semantic-sidebar-accent-foreground': '#101828',
    'semantic-sidebar-border': 'rgba(16, 24, 40, 0.08)',
    'semantic-sidebar-ring': 'rgba(15, 107, 242, 0.4)',

    // ── Appearance-conditioned component values (work package N) — light ──
    'state-destructive-tint-percent': '10%',
    'state-destructive-border': 'var(--destructive)',
    'state-destructive-focus-ring': '20%',
    'state-destructive-hover-tint-percent': '20%',
    'state-primary-border-tint-percent': '30%',
    'state-primary-fill-tint-percent': '5%',
    'state-input-tint-percent': '50%',
    'state-input-disabled-tint-percent': '50%',
    'state-input-solid': 'var(--zy-surface-raised)',
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
    'state-login-hover-tint':
      'color-mix(in oklab, var(--zy-component-palette-black) 3%, transparent)',
    'state-muted-tab-text': 'color-mix(in oklab, var(--foreground) 60%, transparent)',
    'state-page-pill-bg': 'transparent',
    'state-page-pill-hover': 'var(--muted)',
    'state-session-tint': 'color-mix(in oklab, var(--zy-component-palette-black) 4%, transparent)',

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
    'component-editor-background': '#FFFFFF',
    'component-editor-foreground': '#101828',
    'component-editor-gutter': '#F4F5F7',
    'component-editor-selection': 'rgba(15, 107, 242, 0.14)',
    'component-editor-active-line': 'rgba(16, 24, 40, 0.04)',
    'component-editor-deleted': 'rgba(217, 45, 32, 0.1)',
    'component-editor-inserted': 'rgba(7, 148, 85, 0.1)',
    'component-editor-indent': 'rgba(16, 24, 40, 0.04)',
    'component-editor-indent-active': 'rgba(15, 107, 242, 0.16)',
    'component-editor-deleted-chunk': 'rgba(217, 45, 32, 0.08)',
    'component-editor-inserted-chunk': 'rgba(7, 148, 85, 0.08)',
    'component-editor-changed': 'rgba(220, 104, 3, 0.14)',
    'component-editor-search': 'rgba(220, 104, 3, 0.22)',
    'component-editor-search-selected': 'rgba(220, 104, 3, 0.36)',
    'component-editor-error': 'rgba(217, 45, 32, 0.14)',
    'component-editor-indent-fallback': 'rgba(16, 24, 40, 0.04)',
    'component-editor-indent-active-fallback': 'rgba(15, 107, 242, 0.12)',

    // ── Overlay ──
    'component-overlay-strong': 'rgba(16, 24, 40, 0.4)',

    // ── Diff Colors ──
    'component-diff-added': '#079455',
    'component-diff-removed': '#D92D20',
    'component-diff-added-background': 'rgba(7, 148, 85, 0.1)',
    'component-diff-removed-background': 'rgba(217, 45, 32, 0.1)',

    // ── Component Misc ──
    'component-shimmer': 'rgba(16, 24, 40, 0.06)',

    // ── Syntax Highlighting (CodeMirror) ──
    'syntax-codemirror-0': '#FFFFFF',
    'syntax-codemirror-6': '#667085',
    'syntax-codemirror-7': '#0F6BF2',
    'syntax-codemirror-8': '#079455',
    'syntax-codemirror-9': '#7C3AED',
    'syntax-codemirror-10': '#DC6803',
    'syntax-codemirror-11': '#D92D20',
    'syntax-codemirror-12': '#DB2777',
    'syntax-codemirror-13': '#0891B2',
    'syntax-codemirror-14': '#65A30D',
    'syntax-codemirror-15': '#EA580C',
    'syntax-codemirror-16': '#9333EA',
    'syntax-codemirror-17': '#0D9488',
    'syntax-codemirror-18': '#F97316',

    // ── Syntax Highlighting (Shiki) ──
    'syntax-shiki-foreground': '#101828',
    'syntax-shiki-background': '#FFFFFF',
    'syntax-shiki-token-comment': '#667085',
    'syntax-shiki-token-keyword': '#7C3AED',
    'syntax-shiki-token-string': '#079455',
    'syntax-shiki-token-string-expression': '#067647',
    'syntax-shiki-token-constant': '#DC6803',
    'syntax-shiki-token-parameter': '#0F6BF2',
    'syntax-shiki-token-function': '#0891B2',
    'syntax-shiki-token-punctuation': '#475467',
    'syntax-shiki-token-link': '#0C5FD9',
    'syntax-shiki-ansi-black': '#101828',
    'syntax-shiki-ansi-bright-black': '#475467',
    'syntax-shiki-ansi-red': '#D92D20',
    'syntax-shiki-ansi-bright-red': '#F04438',
    'syntax-shiki-ansi-green': '#079455',
    'syntax-shiki-ansi-bright-green': '#12B76A',
    'syntax-shiki-ansi-yellow': '#DC6803',
    'syntax-shiki-ansi-bright-yellow': '#F79009',
    'syntax-shiki-ansi-blue': '#0F6BF2',
    'syntax-shiki-ansi-bright-blue': '#4C8DFF',
    'syntax-shiki-ansi-magenta': '#7C3AED',
    'syntax-shiki-ansi-bright-magenta': '#A78BFA',
    'syntax-shiki-ansi-cyan': '#0891B2',
    'syntax-shiki-ansi-bright-cyan': '#22D3EE',
    'syntax-shiki-ansi-white': '#E2E8F0',
    'syntax-shiki-ansi-bright-white': '#F8FAFC',
  },
};
