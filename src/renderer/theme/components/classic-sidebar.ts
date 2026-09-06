import { recipe } from './recipe';
export function classicSidebar() {
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
        'transition-property': 'margin, opacity',
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
        'transition-property': 'width, height, padding',
        'transition-duration': '150ms',
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
    'sidebar-gap': recipe({
      base: {
        'transition-property': 'width',
        'transition-duration': '200ms',
        'transition-timing-function': 'linear',
      },
    }),
    'sidebar-container-motion': recipe({
      base: {
        'transition-property': 'left, right, width',
        'transition-duration': '200ms',
        'transition-timing-function': 'linear',
      },
    }),
    'sidebar-container-left-border': recipe({
      base: { 'border-right-width': '1px', 'border-style': 'solid' },
    }),
    'sidebar-container-right-border': recipe({
      base: { 'border-left-width': '1px', 'border-style': 'solid' },
    }),
  };
}
