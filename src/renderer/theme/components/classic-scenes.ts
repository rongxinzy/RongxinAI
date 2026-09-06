import { recipe } from './recipe';
export function classicScenes() {
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
