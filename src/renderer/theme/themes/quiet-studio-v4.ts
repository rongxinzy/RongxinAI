import type { ComponentAppearances } from '../components/contract';
import { recipe } from '../components/recipe';

/**
 * v4.0 Quiet Studio appearance overrides.
 *
 * The shell, home composer and their shared controls are re-described here in
 * DESIGN.md v4 values while the existing appearance contract and engine stay
 * untouched. Structural layout still belongs to the React components.
 */

const transition = {
  'transition-property': 'color, background-color, border-color, box-shadow, opacity, translate',
  'transition-duration': '120ms',
  'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

const focusRing = {
  'outline-color': 'var(--ring)',
  'outline-style': 'solid',
  'outline-width': '2px',
  'outline-offset': '1px',
  'box-shadow': 'none',
} as const;

const sansFont =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif";
const monoFont = "'SF Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace";

export const quietStudioLightTokens: Record<string, string> = {
  // Six-step type scale, 12 / 14 / 16 / 18 / 20 / 24.
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
  'component-text-3xl': '28px',
  'component-text-3xl--line-height': '36px',
  'style-text-xxl': '24px',
  'style-text-xxl--line-height': '32px',
  'style-body-leading': '1.5',

  'style-font-sans': sansFont,
  'style-font-heading': sansFont,
  'style-font-mono': monoFont,

  radius: '8px',
  'semantic-radius': '8px',
  'semantic-radius-sm': '4px',
  'semantic-radius-md': '6px',
  'semantic-radius-lg': '8px',
  'semantic-radius-xl': '12px',
  'style-radius-sm': '4px',
  'style-radius-md': '6px',
  'style-radius-lg': '8px',
  'style-radius-xl': '12px',
  'style-radius-2xl': '16px',
  'style-radius-3xl': '20px',
  'style-work-chat-thumb-radius': '6px',

  'style-shadow-xs': '0 1px 2px rgba(16, 24, 40, 0.04)',
  'style-shadow-sm': '0 1px 3px rgba(16, 24, 40, 0.04), 0 6px 16px -4px rgba(16, 24, 40, 0.06)',
  'style-shadow-md': '0 2px 4px rgba(16, 24, 40, 0.04), 0 12px 32px -6px rgba(16, 24, 40, 0.10)',
  'style-shadow-lg': '0 16px 48px -12px rgba(16, 24, 40, 0.16)',
  'style-shadow-xl': '0 16px 48px -12px rgba(16, 24, 40, 0.16)',
  'style-shadow-2xl': '0 16px 48px -12px rgba(16, 24, 40, 0.16)',
  'style-shadow-subtle': '0 1px 2px rgba(16, 24, 40, 0.04)',
  'style-shadow-card': '0 1px 2px rgba(16, 24, 40, 0.04)',
  'style-shadow-elevated':
    '0 2px 4px rgba(16, 24, 40, 0.04), 0 12px 32px -6px rgba(16, 24, 40, 0.10)',
  'style-shadow-modal': '0 16px 48px -12px rgba(16, 24, 40, 0.16)',
  'style-shadow-popover': '0 16px 48px -12px rgba(16, 24, 40, 0.16)',
  'style-shadow-glow-accent': 'none',
  'style-shadow-inset': 'none',
  'style-ease-smooth': 'cubic-bezier(0.2, 0, 0, 1)',

  // Window / panel / raised / overlay.
  background: '#FFFFFF',
  foreground: '#181D27',
  surface: '#F4F5F7',
  'surface-foreground': '#181D27',
  'surface-raised': '#FFFFFF',
  'surface-tertiary': '#F4F5F7',
  'surface-overlay': '#FFFFFF',

  accent: 'rgba(16, 24, 40, 0.04)',
  'accent-foreground': '#181D27',

  'chat-user': 'rgba(16, 24, 40, 0.04)',
  'chat-user-foreground': '#181D27',
  'chat-bot': 'transparent',
  'chat-bot-foreground': '#181D27',

  'text-primary': '#181D27',
  'text-muted-foreground': '#535862',
  'text-muted': '#717680',

  border: 'rgba(16, 24, 40, 0.06)',
  'border-subtle': 'rgba(16, 24, 40, 0.06)',
  'input-border': 'rgba(16, 24, 40, 0.08)',

  primary: '#3D70E0',
  'primary-foreground': '#FFFFFF',
  'primary-hover': '#3567D6',
  'primary-strong': '#3D70E0',
  'primary-muted': 'rgba(61, 112, 224, 0.10)',
  'switch-thumb-foreground': '#181D27',
  'switch-track-checked': '#181D27',
  'switch-track-checked-hover': '#344054',

  destructive: '#D92D20',
  'destructive-foreground': '#FFFFFF',
  'style-destructive-confirm': '#D92D20',
  success: '#079455',
  warning: '#DC6803',

  ring: 'rgba(61, 112, 224, 0.40)',

  'semantic-background': '#FFFFFF',
  'semantic-foreground': '#181D27',
  'semantic-card': '#FFFFFF',
  'semantic-card-foreground': '#181D27',
  'semantic-popover': '#FFFFFF',
  'semantic-popover-foreground': '#181D27',
  'semantic-primary': '#3D70E0',
  'semantic-primary-foreground': '#FFFFFF',
  'semantic-secondary': 'rgba(16, 24, 40, 0.04)',
  'semantic-secondary-foreground': '#181D27',
  'semantic-muted': 'rgba(16, 24, 40, 0.04)',
  'semantic-muted-foreground': '#535862',
  'semantic-accent': 'rgba(16, 24, 40, 0.04)',
  'semantic-accent-foreground': '#181D27',
  'semantic-destructive': '#D92D20',
  'semantic-border': 'rgba(16, 24, 40, 0.06)',
  'semantic-input': 'rgba(16, 24, 40, 0.08)',
  'semantic-ring': 'rgba(61, 112, 224, 0.40)',

  'semantic-sidebar': '#F4F5F7',
  'semantic-sidebar-foreground': '#181D27',
  'semantic-sidebar-primary': '#3D70E0',
  'semantic-sidebar-primary-foreground': '#FFFFFF',
  'semantic-sidebar-accent': 'rgba(16, 24, 40, 0.06)',
  'semantic-sidebar-accent-foreground': '#181D27',
  'semantic-sidebar-border': 'rgba(16, 24, 40, 0.06)',
  'semantic-sidebar-ring': 'rgba(61, 112, 224, 0.40)',

  'state-input-solid': '#FFFFFF',
  'state-input-hover': 'rgba(16, 24, 40, 0.04)',
  'state-input-border': 'rgba(16, 24, 40, 0.08)',
  'state-input-field': 'transparent',
  'state-muted-hover': 'rgba(16, 24, 40, 0.04)',
  'state-login-hover-tint': 'rgba(16, 24, 40, 0.04)',
  'state-session-tint': 'rgba(16, 24, 40, 0.03)',
  'state-page-pill-bg': 'rgba(16, 24, 40, 0.025)',
  'state-page-pill-hover': 'rgba(16, 24, 40, 0.06)',
  'state-muted-tab-text': '#535862',
  'state-tab-selected-border': 'rgba(16, 24, 40, 0.08)',
  'state-input-tint-percent': '50%',
  'state-input-disabled-tint-percent': '50%',
  'state-destructive-tint-percent': '10%',
  'state-destructive-border': '#D92D20',
  'state-destructive-focus-ring': '20%',
  'state-destructive-hover-tint-percent': '14%',
  'state-primary-border-tint-percent': '30%',
  'state-primary-fill-tint-percent': '8%',

  'style-work-chat-thumb': '#FFFFFF',
  'style-work-chat-track': 'rgba(16, 24, 40, 0.08)',
  'style-switch-thumb': '#FFFFFF',

  'scroll-thumb': 'rgba(16, 24, 40, 0.18)',
  'scroll-thumb-hover': 'rgba(16, 24, 40, 0.28)',
};

export const quietStudioDarkTokens: Record<string, string> = {
  'semantic-background': '#18191D',
  'semantic-foreground': '#DFE1E6',
  'semantic-card': '#1F2126',
  'semantic-card-foreground': '#DFE1E6',
  'semantic-popover': '#25272F',
  'semantic-popover-foreground': '#DFE1E6',
  'semantic-primary': '#3D70E0',
  'semantic-primary-foreground': '#FFFFFF',
  'semantic-secondary': 'rgba(255, 255, 255, 0.05)',
  'semantic-secondary-foreground': '#DFE1E6',
  'semantic-muted': 'rgba(255, 255, 255, 0.04)',
  'semantic-muted-foreground': '#969DA8',
  'semantic-accent': 'rgba(255, 255, 255, 0.04)',
  'semantic-accent-foreground': '#DFE1E6',
  'semantic-destructive': '#F97066',
  'semantic-border': 'rgba(255, 255, 255, 0.05)',
  'semantic-input': 'rgba(255, 255, 255, 0.08)',
  'semantic-ring': 'rgba(61, 112, 224, 0.50)',
  'semantic-sidebar': '#121316',
  'semantic-sidebar-foreground': '#DFE1E6',
  'semantic-sidebar-primary': '#3D70E0',
  'semantic-sidebar-primary-foreground': '#FFFFFF',
  'semantic-sidebar-accent': 'rgba(255, 255, 255, 0.06)',
  'semantic-sidebar-accent-foreground': '#DFE1E6',
  'semantic-sidebar-border': 'rgba(255, 255, 255, 0.05)',
  'semantic-sidebar-ring': 'rgba(61, 112, 224, 0.50)',

  background: '#18191D',
  foreground: '#DFE1E6',
  surface: '#121316',
  'surface-foreground': '#DFE1E6',
  'surface-raised': '#1F2126',
  'surface-tertiary': '#18191D',
  'surface-overlay': '#25272F',
  accent: 'rgba(255, 255, 255, 0.04)',
  'accent-foreground': '#DFE1E6',
  'chat-user': 'rgba(255, 255, 255, 0.05)',
  'chat-user-foreground': '#DFE1E6',
  'chat-bot': 'transparent',
  'chat-bot-foreground': '#DFE1E6',
  'text-primary': '#DFE1E6',
  'text-muted-foreground': '#969DA8',
  'text-muted': '#6E7480',
  border: 'rgba(255, 255, 255, 0.05)',
  'border-subtle': 'rgba(255, 255, 255, 0.05)',
  'input-border': 'rgba(255, 255, 255, 0.08)',
  primary: '#3D70E0',
  'primary-foreground': '#FFFFFF',
  'primary-hover': '#3567D6',
  'primary-strong': '#3D70E0',
  'primary-muted': 'rgba(61, 112, 224, 0.16)',
  'switch-thumb-foreground': '#DFE1E6',
  'switch-track-checked': '#DFE1E6',
  'switch-track-checked-hover': '#FFFFFF',
  destructive: '#F97066',
  'destructive-foreground': '#1F2126',
  'style-destructive-confirm': '#F97066',
  success: '#47CD89',
  warning: '#FDB022',
  ring: 'rgba(61, 112, 224, 0.50)',

  'style-shadow-xs': 'none',
  'style-shadow-sm': '0 8px 24px -8px rgba(0, 0, 0, 0.45)',
  'style-shadow-md': '0 12px 32px -8px rgba(0, 0, 0, 0.55)',
  'style-shadow-lg': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
  'style-shadow-xl': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
  'style-shadow-2xl': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
  'style-shadow-subtle': 'none',
  'style-shadow-card': 'none',
  'style-shadow-elevated': '0 12px 32px -8px rgba(0, 0, 0, 0.55)',
  'style-shadow-modal': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
  'style-shadow-popover': '0 16px 48px -12px rgba(0, 0, 0, 0.65)',
  'style-shadow-glow-accent': 'none',

  'state-input-solid': '#1F2126',
  'state-input-hover': 'rgba(255, 255, 255, 0.04)',
  'state-input-border': 'rgba(255, 255, 255, 0.08)',
  'state-input-field': 'transparent',
  'state-muted-hover': 'rgba(255, 255, 255, 0.04)',
  'state-login-hover-tint': 'rgba(255, 255, 255, 0.04)',
  'state-session-tint': 'rgba(255, 255, 255, 0.03)',
  'state-page-pill-bg': 'rgba(255, 255, 255, 0.03)',
  'state-page-pill-hover': 'rgba(255, 255, 255, 0.06)',
  'state-muted-tab-text': '#969DA8',
  'state-tab-selected-border': 'rgba(255, 255, 255, 0.08)',
  'state-destructive-border': '#F97066',

  'style-work-chat-thumb': '#1F2126',
  'style-work-chat-track': 'rgba(255, 255, 255, 0.06)',
  'style-switch-thumb': '#18191D',

  'scroll-thumb': 'rgba(255, 255, 255, 0.16)',
  'scroll-thumb-hover': 'rgba(255, 255, 255, 0.24)',
};

export function quietStudioAppearances(): Partial<ComponentAppearances> {
  return {
    'shell-main-panel': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--zy-background)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
    }),
    'shell-brand': recipe({
      base: {
        height: '2rem',
        gap: '0.5rem',
        color: 'var(--zy-text-primary)',
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'shell-brand-mark': recipe({ base: { height: '1.25rem' } }),
    'shell-kbd': recipe({
      base: {
        height: '1.125rem',
        'padding-inline': '0.375rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1.125rem',
        color: 'var(--zy-text-muted)',
        'box-shadow': 'inset 0 0 0 1px var(--zy-border)',
      },
    }),
    'shell-sidebar-time': recipe({
      base: {
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      parentHover: { opacity: '1' },
      parentFocus: { opacity: '1' },
    }),
    'shell-account-avatar': recipe({
      base: {
        height: '1.75rem',
        width: '1.75rem',
        'border-radius': '9999px',
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'shell-account-name': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.125rem',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-text-primary)',
      },
    }),
    'shell-account-hint': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': 'var(--zy-component-text-xs--line-height)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'shell-status-dot': recipe({
      base: {
        height: '0.375rem',
        width: '0.375rem',
        'border-radius': '9999px',
        'background-color': 'var(--zy-success)',
      },
    }),
    'shell-status-dot-warning': recipe({
      base: {
        height: '0.375rem',
        width: '0.375rem',
        'border-radius': '9999px',
        'background-color': 'var(--zy-warning)',
      },
    }),
    'home-greeting': recipe({
      base: {
        'font-size': 'var(--zy-component-text-2xl)',
        'line-height': 'var(--zy-component-text-2xl--line-height)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--zy-text-primary)',
      },
    }),

    'shell-sidebar': recipe({
      base: {
        'background-color': 'var(--sidebar)',
        color: 'var(--zy-text-primary)',
        'border-right-width': '0px',
        'border-style': 'solid',
        'border-color': 'transparent',
      },
    }),
    'shell-sidebar-header': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.25rem',
        'padding-inline-start': '0.625rem',
        'border-bottom-width': '0px',
        'border-style': 'solid',
        'border-color': 'transparent',
      },
    }),
    'shell-sidebar-logo': recipe({ base: { height: '1.25rem' } }),
    'shell-sidebar-section': recipe({
      base: {
        height: '1.75rem',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-text-muted)',
        'background-color': 'var(--sidebar)',
      },
    }),
    'shell-sidebar-scroll': recipe({
      base: { 'padding-inline': '0.5rem', 'padding-bottom': '0.5rem' },
    }),
    'shell-sidebar-footer': recipe({
      base: {
        'padding-inline': '0.25rem',
        'padding-block': '0.5rem',
        'border-top-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
      },
    }),
    'shell-sidebar-nav': recipe({
      base: {
        ...transition,
        height: '2rem',
        gap: '0.625rem',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '0px',
        'box-shadow': 'none',
        'background-color': 'transparent',
        color: 'var(--zy-text-secondary)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
      pressed: { 'background-color': 'var(--sidebar-accent)', translate: '0px 1px' },
      focus: focusRing,
      disabled: { opacity: '0.5' },
    }),
    'shell-sidebar-nav-selected': recipe({
      base: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      hover: { 'background-color': 'var(--sidebar-accent)', color: 'var(--zy-text-primary)' },
      selected: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      pressed: { 'background-color': 'var(--sidebar-accent)' },
    }),
    'shell-sidebar-task': recipe({
      base: {
        ...transition,
        height: '2rem',
        padding: '0px',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'border-radius': 'var(--zy-style-radius-lg)',
      },
    }),
    'shell-sidebar-task-selected': recipe({
      base: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'shell-sidebar-task-idle': recipe({
      base: { 'background-color': 'transparent', color: 'var(--zy-text-primary)' },
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
    }),
    'shell-sidebar-task-main': recipe({
      base: {
        ...transition,
        height: '2rem',
        'padding-left': '0.625rem',
        'padding-right': '3.625rem',
        'background-color': 'transparent',
        'border-width': '0px',
        'box-shadow': 'none',
        'font-weight': 'inherit',
        'text-align': 'left',
        color: 'inherit',
        'border-radius': 'var(--zy-style-radius-lg)',
      },
      hover: { 'background-color': 'transparent' },
      pressed: { 'background-color': 'var(--sidebar-accent)', translate: '0px 1px' },
      focus: focusRing,
    }),
    'shell-sidebar-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'shell-sidebar-workspace': recipe({
      base: {
        ...transition,
        height: '2rem',
        'background-color': 'transparent',
        color: 'var(--zy-text-primary)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'box-shadow': 'none',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
      selected: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'shell-sidebar-workspace-main': recipe({
      base: {
        ...transition,
        height: '2rem',
        'padding-inline': '0.625rem',
        gap: '0.5rem',
        color: 'inherit',
        'font-weight': 'inherit',
        'text-align': 'left',
        'border-width': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'transparent' },
      expanded: { 'background-color': 'transparent', color: 'inherit' },
      pressed: { translate: '0px 1px' },
      focus: focusRing,
    }),
    'shell-sidebar-action': recipe({
      base: {
        ...transition,
        opacity: '0',
        color: 'var(--zy-text-muted)',
        'border-width': '0px',
        'box-shadow': 'none',
      },
      parentHover: { opacity: '1' },
      parentFocus: { opacity: '1' },
      hover: { color: 'var(--zy-text-primary)', 'background-color': 'var(--accent)' },
      focus: { ...focusRing, opacity: '1' },
      expanded: { opacity: '1', 'background-color': 'var(--sidebar-accent)' },
    }),
    'shell-mode': recipe({
      base: {
        height: '2rem',
        width: '100%',
        'border-width': '0px',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--sidebar-accent)',
        'box-shadow': 'none',
      },
      checked: { 'background-color': 'var(--sidebar-accent)' },
      focus: focusRing,
    }),
    'shell-mode-thumb': recipe({
      base: {
        height: '1.75rem',
        width: 'calc(50% - 4px)',
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--card)',
        'box-shadow': '0 0 0 1px var(--zy-border), var(--zy-style-shadow-xs)',
        'transition-property': 'translate',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'shell-mode-label': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-text-secondary)',
      },
    }),
    'shell-mode-label-selected': recipe({
      base: {
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-text-primary)',
      },
    }),

    heading: recipe({ base: { 'font-family': 'var(--zy-style-font-heading)' } }),

    // Empty states: short 18px title, 14px explanation, one CTA. No oversized
    // icon tile, no dashed card around the whole block.
    'empty-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-lg)',
        'line-height': 'var(--zy-component-text-lg--line-height)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--zy-text-primary)',
      },
    }),
    'empty-description': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': 'var(--zy-component-text-sm--line-height)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'empty-media-icon': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'transparent',
        color: 'var(--zy-text-muted)',
      },
    }),
    'scene-model-empty': recipe({
      base: {
        'border-width': '0px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'background-color': 'transparent',
        padding: '1.5rem',
      },
    }),
    'scene-model-empty-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-lg)',
        'line-height': 'var(--zy-component-text-lg--line-height)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--zy-text-primary)',
      },
    }),

    // Page tabs: the shared underline is the only selected affordance.
    'tabs-line-trigger': recipe({
      base: { 'background-color': 'transparent' },
      selected: {
        'background-color': 'transparent',
        'border-color': 'transparent',
        'box-shadow': 'none',
        color: 'var(--zy-text-primary)',
      },
    }),

    button: recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-style': 'solid',
        'border-width': '0px',
        'border-color': 'transparent',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'outline-style': 'none',
        ...transition,
      },
      focus: focusRing,
      pressed: { translate: '0 1px' },
      disabled: { opacity: '0.5' },
      invalid: {
        'border-color': 'var(--zy-destructive)',
        'box-shadow': '0 0 0 2px color-mix(in oklab, var(--zy-destructive) 20%, transparent)',
      },
    }),
    'button-default': recipe({
      base: {
        'background-color': 'var(--zy-primary)',
        color: 'var(--primary-foreground)',
        'border-width': '0px',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 92%, black)' },
      disabled: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-muted)',
        opacity: '1',
      },
    }),
    'button-secondary': recipe({
      base: {
        'background-color': 'var(--card)',
        color: 'var(--zy-text-primary)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      hover: {
        'background-color': 'var(--card)',
        'border-color': 'var(--zy-input-border)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
        color: 'var(--zy-text-primary)',
      },
      pressed: { translate: '0 1px' },
    }),
    'button-outline': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-input-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-text-primary)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
      hover: {
        'background-color': 'var(--accent)',
        'border-color': 'var(--zy-input-border)',
        color: 'var(--zy-text-primary)',
      },
      expanded: {
        'background-color': 'var(--accent)',
        'border-color': 'var(--zy-input-border)',
        color: 'var(--zy-text-primary)',
      },
    }),
    'button-ghost': recipe({
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
      expanded: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
    }),
    'button-appearance': recipe({
      base: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-text-primary)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
      hover: {
        'border-color': 'var(--zy-input-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-text-primary)',
      },
      selected: {
        'border-color': 'var(--zy-text-primary)',
        'background-color': 'var(--card)',
        color: 'var(--zy-text-primary)',
        'box-shadow': 'var(--zy-style-shadow-xs)',
      },
    }),
    'button-navigation': recipe({
      base: {
        ...transition,
        color: 'var(--zy-text-secondary)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--zy-text-primary)' },
      selected: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-primary)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'button-size-default': recipe({
      base: { height: '2rem', gap: '0.375rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-sm': recipe({
      base: { height: '2rem', gap: '0.375rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-lg': recipe({
      base: { height: '2.25rem', gap: '0.5rem', 'padding-inline': '0.75rem' },
    }),
    'button-size-navigation': recipe({
      base: { height: '2rem', gap: '0.625rem', 'padding-inline': '0.625rem' },
    }),
    'button-size-icon': recipe({ base: { height: '2rem', width: '2rem' } }),
    'button-size-icon-sm': recipe({ base: { height: '1.75rem', width: '1.75rem' } }),
    'button-size-icon-xs': recipe({ base: { height: '1.5rem', width: '1.5rem' } }),
    'page-login-button-button-1': recipe({
      base: {
        height: '2.75rem',
        gap: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.25rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-text-primary)',
        ...transition,
      },
      hover: { 'background-color': 'var(--accent)' },
      focus: focusRing,
    }),
    'action-window': recipe({
      base: {
        height: '1.75rem',
        width: '2.25rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--zy-text-muted)',
      },
      hover: { color: 'var(--zy-text-primary)', 'background-color': 'var(--accent)' },
    }),
    'page-window-title-bar-button-1': recipe({
      base: {
        height: '1.75rem',
        width: '2.25rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--zy-text-muted)',
      },
      hover: {
        'background-color': 'var(--zy-destructive)',
        color: 'var(--zy-destructive-foreground)',
      },
    }),

    'home-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': 'var(--zy-component-text-sm--line-height)',
        color: 'var(--zy-text-muted)',
      },
    }),
    'home-prompt-editor': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
        'min-height': '3rem',
      },
    }),
    'home-status': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--zy-text-muted)',
        'transition-property': 'opacity',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
    }),
    'home-status-icon': recipe({
      base: { width: '0.75rem', height: '0.75rem', color: 'var(--zy-text-muted)' },
    }),

    'composer-surface': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-3xl)',
        'box-shadow': 'none',
        'transition-property': 'box-shadow',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      composerFocus: { 'box-shadow': 'none' },
    }),
    'composer-input-surface': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-3xl)',
        'background-color': 'var(--card)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-input-border)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
      },
      groupFocus: {
        'border-color': 'color-mix(in oklab, var(--zy-input-border) 60%, var(--zy-primary))',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
      composerFocus: {
        'border-color': 'color-mix(in oklab, var(--zy-input-border) 60%, var(--zy-primary))',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
    }),
    'input-submit': recipe({
      base: {
        'border-radius': '9999px',
        height: '2rem',
        width: '2rem',
        'background-color': 'var(--zy-primary)',
        color: 'var(--zy-primary-foreground)',
        'transition-property': 'background-color, color, translate',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 92%, black)' },
      pressed: { translate: '0 1px' },
      disabled: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-muted)',
        opacity: '1',
      },
      focus: focusRing,
    }),
    'page-quick-action-bar-button-1': recipe({
      base: {
        gap: '0.375rem',
        'padding-inline': '0.75rem',
        'padding-block': '0px',
        height: '2rem',
        'border-radius': '9999px',
        'border-width': '1px',
        'border-style': 'solid',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
        'background-color': 'var(--zy-state-page-pill-bg)',
        'border-color': 'var(--zy-border)',
        'box-shadow': 'none',
        color: 'var(--zy-text-secondary)',
      },
      hover: {
        'background-color': 'var(--zy-state-page-pill-hover)',
        'border-color': 'var(--zy-input-border)',
        color: 'var(--zy-text-primary)',
      },
    }),
  };
}
