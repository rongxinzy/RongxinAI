import { recipe } from './recipe';

function classicScenes() {
  return {
    'loading-shimmer': recipe({
      base: {
        'animation-name': 'none',
        'background-color': 'var(--zy-surface-raised)',
        'border-radius': '0.25rem',
      },
    }),
    'loading-shimmer-layer': recipe({
      base: {
        'background-image':
          'linear-gradient(90deg, transparent, var(--zy-component-shimmer), transparent)',
        'animation-name': 'component-motion',
        'animation-duration': '1.5s',
        'animation-timing-function': 'ease',
        'animation-iteration-count': 'infinite',
      },
      motionStart: { translate: '-100% 0' },
      motionEnd: { translate: '100% 0' },
    }),
    'scene-preview-loading': recipe({ base: { 'border-radius': 'var(--zy-style-radius-lg)' } }),
    'scene-coding-empty': recipe({
      base: { 'border-width': '1px', 'border-style': 'solid', 'border-color': 'var(--border)' },
    }),
    'scene-choice': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.5rem',
        'padding-block': '0.375rem',
        'transition-property': 'color, background-color, border-color',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'scene-choice-selected': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'scene-prompt-avatar': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--muted)',
      },
    }),
    'scene-prompt-avatar-outline': recipe({
      base: { 'border-radius': 'var(--zy-style-radius-md)' },
    }),
    'scene-prompt-avatar-fallback': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--muted-foreground)',
      },
    }),
    'scene-trajectory-loading': recipe({
      base: { width: '1.75rem', height: '1.75rem', 'border-radius': '9999px' },
    }),
    'scene-expert-avatar': recipe({
      base: {
        width: '2.5rem',
        height: '2.5rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'scene-expert-empty-avatar': recipe({
      base: {
        width: '2.5rem',
        height: '2.5rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--muted)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'scene-expert-fallback': recipe({
      base: {
        'border-radius': 'inherit',
        'font-size': 'var(--zy-component-text-xl)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--muted-foreground)',
      },
    }),
    'scene-expert-artwork': recipe({
      base: { 'border-radius': 'inherit', 'background-color': 'transparent' },
    }),
    'scene-access-switch': recipe({
      base: { 'border-color': 'var(--border)' },
      checked: { 'border-color': 'var(--primary)', 'background-color': 'var(--primary)' },
    }),
    'scene-access-switch-off': recipe({ base: { 'background-color': 'var(--muted)' } }),
    'scene-memory-choice': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.75rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)' },
    }),
    'scene-market-loading': recipe({
      base: { width: '2.5rem', height: '2.5rem', 'border-radius': 'var(--zy-style-radius-lg)' },
    }),
    'scene-model-empty': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'dashed',
        'border-color': 'var(--border)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
        padding: '1.5rem',
      },
    }),
    'scene-model-empty-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-lg)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'scene-history': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
        padding: '1rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'scene-history-head-start': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'scene-history-head-center': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'scene-history-head-end': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'scene-history-row': recipe({ base: {}, hover: { 'background-color': 'var(--muted)' } }),
    'scene-email-field': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.75rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
      },
    }),
    'scene-skill-avatar': recipe({
      base: {
        width: '2.5rem',
        height: '2.5rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--muted)',
      },
    }),
    'scene-skill-fallback': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-xl)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--muted-foreground)',
      },
    }),
    'scene-skill-document-avatar': recipe({
      base: { width: '2.25rem', height: '2.25rem', 'border-radius': 'var(--zy-style-radius-lg)' },
    }),
    'scene-skill-document-fallback': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-lg)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        color: 'var(--muted-foreground)',
      },
    }),
    'scene-skill-progress': recipe({ base: { height: '0.25rem', 'border-radius': '0px' } }),
    'scene-loading-message': recipe({ base: { 'border-radius': 'var(--zy-style-radius-lg)' } }),
    'scene-loading-composer': recipe({ base: { 'border-radius': 'var(--zy-style-radius-xl)' } }),
  };
}

function classicSidebar() {
  return {
    'sidebar-inset-wrapper': recipe({ base: { 'background-color': 'var(--sidebar)' } }),
    'sidebar-static': recipe({
      base: { 'background-color': 'var(--sidebar)', color: 'var(--sidebar-foreground)' },
    }),
    'sidebar-shell': recipe({ base: { color: 'var(--sidebar-foreground)' } }),
    'sidebar-inner': recipe({ base: { 'background-color': 'var(--sidebar)' } }),
    'sidebar-floating': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'box-shadow': '0 0 0 1px var(--sidebar-border), var(--zy-style-shadow-sm)',
      },
    }),
    'sidebar-inset': recipe({ base: { 'background-color': 'var(--background)' } }),
    'sidebar-inset-raised': recipe({
      base: {},
      wide: {
        'border-radius': 'var(--zy-style-radius-xl)',
        'box-shadow': 'var(--zy-style-shadow-sm)',
      },
    }),
    'sidebar-separator': recipe({ base: { 'background-color': 'var(--sidebar-border)' } }),
    'sidebar-label': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'outline-style': 'none',
        color: 'color-mix(in oklab, var(--sidebar-foreground) 70%, transparent)',
        height: '2rem',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'opacity',
        'transition-duration': '200ms',
        'transition-timing-function': 'linear',
      },
      focus: { 'box-shadow': '0 0 0 2px var(--sidebar-ring)' },
    }),
    'sidebar-label-collapsed': recipe({ base: { opacity: '0' } }),
    'sidebar-action': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'outline-style': 'none',
        color: 'var(--sidebar-foreground)',
        width: '1.25rem',
        padding: '0px',
        'transition-property': 'transform',
        'transition-duration': '150ms',
      },
      hover: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      focus: { 'box-shadow': '0 0 0 2px var(--sidebar-ring)' },
    }),
    'sidebar-content-type': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'sidebar-menu-button': recipe({
      base: {
        width: '100%',
        'border-radius': 'var(--zy-style-radius-md)',
        'outline-style': 'none',
        color: 'var(--sidebar-foreground)',
        padding: '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, opacity, box-shadow',
        'transition-duration': '120ms',
      },
      hover: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      pressed: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      focus: { 'box-shadow': '0 0 0 2px var(--sidebar-ring)' },
      disabled: { opacity: '0.5' },
      selected: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'sidebar-menu-clearance': recipe({ base: { 'padding-right': '2rem' } }),
    'sidebar-menu-outline': recipe({
      base: {
        'background-color': 'var(--background)',
        'box-shadow': '0 0 0 1px var(--sidebar-border)',
      },
      hover: { 'box-shadow': '0 0 0 1px var(--sidebar-accent)' },
    }),
    'sidebar-menu-default': recipe({
      base: { height: '2rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'sidebar-menu-sm': recipe({
      base: { height: '1.75rem', 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'sidebar-menu-lg': recipe({
      base: { height: '3rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'sidebar-menu-collapsed': recipe({
      base: { width: '2rem', height: '2rem', padding: '0.5rem' },
    }),
    'sidebar-menu-collapsed-large': recipe({ base: { padding: '0px' } }),
    'sidebar-menu-badge': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'outline-style': 'none',
        color: 'var(--sidebar-foreground)',
        height: '1.25rem',
        'min-width': '1.25rem',
        'padding-inline': '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'font-variant-numeric': 'tabular-nums',
      },
    }),
    'sidebar-menu-peer-hover': recipe({ base: { color: 'var(--sidebar-accent-foreground)' } }),
    'sidebar-menu-peer-active': recipe({ base: { color: 'var(--sidebar-accent-foreground)' } }),
    'sidebar-menu-action-hidden': recipe({ base: {}, wide: { opacity: '0' } }),
    'sidebar-menu-action-visible': recipe({ base: {}, wide: { opacity: '1' } }),
    'sidebar-menu-action-active': recipe({ base: { color: 'var(--sidebar-accent-foreground)' } }),
    'sidebar-icons': recipe({ base: { width: '1rem', height: '1rem' } }),
    'sidebar-skeleton': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.5rem',
      },
    }),
    'sidebar-skeleton-icon': recipe({
      base: { width: '1rem', height: '1rem', 'border-radius': 'var(--zy-style-radius-md)' },
    }),
    'sidebar-skeleton-text': recipe({ base: { height: '1rem' } }),
    'sidebar-sub': recipe({
      base: {
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--sidebar-border)',
        'padding-inline': '0.625rem',
        'padding-block': '0.125rem',
      },
    }),
    'sidebar-sub-button': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'outline-style': 'none',
        color: 'var(--sidebar-foreground)',
        height: '1.75rem',
        'padding-inline': '0.5rem',
      },
      hover: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      pressed: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      focus: { 'box-shadow': '0 0 0 2px var(--sidebar-ring)' },
      selected: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--sidebar-accent-foreground)',
      },
      disabled: { opacity: '0.5' },
    }),
    'sidebar-sub-md': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'sidebar-sub-sm': recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } }),
    'sidebar-sub-icon': recipe({ base: { color: 'var(--sidebar-accent-foreground)' } }),
    'sidebar-gap': recipe({ base: {} }),
    'sidebar-container-motion': recipe({ base: {} }),
    'sidebar-container-left-border': recipe({
      base: { 'border-right-width': '1px', 'border-style': 'solid' },
    }),
    'sidebar-container-right-border': recipe({
      base: { 'border-left-width': '1px', 'border-style': 'solid' },
    }),
  };
}

/** Studio home surfaces inherit every package's colors and typography. */
function homeStudioAppearances() {
  return {
    'companion-window': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-bubble': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-sketch': recipe({
      base: {
        color: 'color-mix(in oklab, #4a74d9 78%, var(--foreground))',
        'transition-property': 'color',
        'transition-duration': '150ms',
      },
    }),
    'companion-sketch-xiaoyuan': recipe({
      base: { color: 'color-mix(in oklab, #4a74d9 78%, var(--foreground))' },
    }),
    'companion-sketch-youli': recipe({
      base: { color: 'color-mix(in oklab, #d96838 78%, var(--foreground))' },
    }),
    'companion-sketch-tuantuan': recipe({
      base: { color: 'color-mix(in oklab, #35969b 76%, var(--foreground))' },
    }),
    'companion-sketch-mianmian': recipe({
      base: { color: 'color-mix(in oklab, #739a6e 76%, var(--foreground))' },
    }),
    'companion-sketch-zhuli': recipe({
      base: { color: 'color-mix(in oklab, #c45a32 78%, var(--foreground))' },
    }),
    'companion-sketch-yunmo': recipe({
      base: { color: 'color-mix(in oklab, #4f8fd6 78%, var(--foreground))' },
    }),
    'companion-sketch-maixiao': recipe({
      base: { color: 'color-mix(in oklab, #d68835 78%, var(--foreground))' },
    }),
    'companion-sketch-paper': recipe({ base: { fill: 'var(--popover)' } }),
    'companion-paper-content': recipe({ base: { 'background-color': 'transparent' } }),
    'companion-fluid-list': recipe({
      base: {
        'background-color': 'transparent',
        'border-bottom-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'border-radius': '0',
      },
    }),
    'companion-fluid-indicator': recipe({
      base: {
        'background-color': 'var(--popover)',
        'border-color': 'var(--muted-foreground)',
        'border-radius': '8px 10px 7px 9px / 9px 7px 10px 8px',
        'box-shadow': 'none',
      },
    }),
    'companion-button': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'color-mix(in oklab, var(--foreground) 45%, transparent)',
        'border-radius': '8px 10px 7px 9px / 9px 7px 10px 8px',
      },
      focus: { 'border-color': 'var(--ring)' },
    }),
    'companion-message-body': recipe({
      base: {
        'background-color': 'transparent',
        'padding-inline': '1rem',
        'padding-block': '0.75rem',
      },
    }),
    'companion-message-user': recipe({ base: { color: 'var(--primary-foreground)' } }),
    'companion-name': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', 'font-weight': '600' },
    }),
    'companion-selector': recipe({
      base: {
        'border-color': 'transparent',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'var(--accent)' },
    }),
    'companion-paper-input': recipe({
      base: {
        'border-color': 'var(--zy-input-border)',
        'background-color': 'transparent',
        'border-radius': '0',
        'border-top-width': '0',
        'border-left-width': '0',
        'border-right-width': '0',
        'border-bottom-width': '1.5px',
        'box-shadow': 'none',
        'transition-property': 'border-color',
        'transition-duration': '120ms',
      },
      groupFocus: {
        'outline-style': 'none',
        'outline-width': '0',
        'box-shadow': 'none',
        'border-color': 'var(--primary)',
      },
    }),
    'welcome-screen': recipe({
      base: {
        'background-color': 'var(--background)',
        color: 'var(--foreground)',
        'transition-property': 'opacity',
        'transition-duration': '360ms',
      },
      exiting: { opacity: '0' },
    }),
    'welcome-title': recipe({
      base: { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' },
    }),
    'welcome-art': recipe({
      base: {
        width: 'min(52rem, 88vw)',
        height: 'min(24rem, 44vh)',
        'animation-name': 'component-motion',
        'animation-duration': '480ms',
        'animation-timing-function': 'ease-out',
        'animation-fill-mode': 'both',
      },
      motionStart: { opacity: '0', translate: '0 0.5rem' },
      motionEnd: { opacity: '1', translate: '0 0' },
    }),
    'home-brand': recipe({ base: { height: '3rem' } }),
    'home-caption': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
      },
    }),
    'home-sticky': recipe({ base: { 'background-color': 'var(--background)' } }),
    'home-prompt-editor': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'min-height': '6rem',
      },
    }),
    'home-folder-warning': recipe({
      base: {
        padding: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--border)',
        'background-color': 'var(--popover)',
        color: 'var(--foreground)',
        'font-size': 'var(--zy-component-text-xs)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
    'home-status': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'home-status-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--muted-foreground)' },
    }),
    'home-status-fading': recipe({ base: { opacity: '0' } }),
  };
}

export function classicScenesAppearances() {
  return {
    ...classicScenes(),
    ...classicSidebar(),
    ...homeStudioAppearances(),
  };
}
