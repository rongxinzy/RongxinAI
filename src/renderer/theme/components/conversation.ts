import { recipe } from './recipe';
import type { AppearanceStyle } from './contract';

/** Quiet Studio conversation surfaces, shared by both complete theme appearances. */
export function conversationAppearances() {
  const motion: AppearanceStyle = {
    'transition-property': 'color, background-color, box-shadow, opacity',
    'transition-duration': '120ms',
    'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
  };
  const border: AppearanceStyle = {
    'border-width': '1px',
    'border-style': 'solid',
    'border-color': 'var(--border)',
  };
  const meta: AppearanceStyle = {
    'font-size': 'var(--zy-component-text-xs)',
    color: 'var(--muted-foreground)',
  };
  const text: AppearanceStyle = {
    'font-size': 'var(--zy-component-text-sm)',
    color: 'var(--foreground)',
  };
  const focus: AppearanceStyle = {
    'outline-style': 'solid',
    'outline-width': '2px',
    'outline-color': 'var(--ring)',
    'outline-offset': '2px',
  };
  return {
    'conversation-meta': recipe({ base: meta }),
    'conversation-status': recipe({ base: { ...text, color: 'var(--muted-foreground)' } }),
    'conversation-heading': recipe({ base: { ...text, 'font-weight': '600' } }),
    'conversation-icon': recipe({
      base: { width: '1rem', height: '1rem', color: 'var(--muted-foreground)' },
    }),
    'thinking-indicator-inline': recipe({
      base: {
        width: '1.25rem',
        height: '1.25rem',
        color: 'var(--muted-foreground)',
        // Canvas ink is sampled once per theme update, not CSS transition frame.
        'transition-property': 'none',
      },
    }),
    'thinking-indicator-companion': recipe({
      base: {
        width: '2rem',
        height: '2rem',
        color: 'var(--muted-foreground)',
        'transition-property': 'none',
      },
    }),
    'conversation-avatar': recipe({
      base: { width: '1.75rem', height: '1.75rem', 'border-radius': '9999px', 'border-width': '0' },
    }),
    'conversation-editor': recipe({
      base: {
        'min-height': '3rem',
        'font-size': 'var(--zy-component-text-base)',
        color: 'var(--foreground)',
        'line-height': '1.5',
      },
    }),
    'conversation-editor-placeholder': recipe({ base: { color: 'var(--zy-text-muted)' } }),
    'conversation-editor-shell': recipe({ base: { 'padding-inline': '0.75rem' } }),
    'conversation-skill-token': recipe({
      base: {
        ...border,
        height: '1.5rem',
        'padding-inline': '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--secondary)',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'line-height': '1',
        color: 'var(--foreground)',
      },
    }),
    'conversation-skill-chip': recipe({
      base: {
        ...border,
        ...motion,
        height: '1.75rem',
        'padding-inline': '0.5rem 0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--secondary)',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'line-height': '1',
        color: 'var(--foreground)',
      },
      hover: { 'background-color': 'var(--accent)', 'border-color': 'var(--zy-input-border)' },
    }),
    'conversation-mention-list': recipe({
      base: {
        ...border,
        width: '18rem',
        padding: '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--popover)',
        color: 'var(--popover-foreground)',
        'box-shadow': 'var(--zy-style-shadow-lg)',
      },
    }),
    'conversation-diff': recipe({
      base: {
        ...border,
        ...meta,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--background)',
      },
    }),
    'conversation-code-fallback': recipe({
      base: {
        ...text,
        'font-family': 'var(--zy-style-font-mono)',
        padding: '0.75rem',
        'background-color': 'var(--muted)',
      },
    }),
    'conversation-source': recipe({
      base: {
        ...border,
        ...meta,
        ...motion,
        height: '1.75rem',
        'padding-inline': '0.625rem',
        'border-radius': '9999px',
        'background-color': 'var(--card)',
        color: 'var(--muted-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'outline-style': 'none',
      },
      hover: {
        'background-color': 'var(--accent)',
        'border-color': 'var(--zy-input-border)',
        color: 'var(--foreground)',
      },
      focus,
    }),
    'conversation-steps': recipe({ base: text }),
    'conversation-steps-trigger': recipe({
      base: { ...text, 'min-height': '2rem', color: 'var(--muted-foreground)' },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
    }),
    'conversation-steps-rail': recipe({
      base: {
        'border-left-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'padding-left': '1rem',
      },
    }),
    'conversation-steps-item': recipe({ base: { 'padding-block': '0.125rem' } }),
    'conversation-actions': recipe({ base: { ...meta, ...motion, opacity: '0' } }),
    'conversation-actions-visible': recipe({ base: { opacity: '1' } }),
    'conversation-actions-hover': recipe({ base: { opacity: '1' } }),
    'conversation-turn-marker': recipe({
      base: {
        ...motion,
        width: '0.5rem',
        height: '0.125rem',
        'border-radius': '9999px',
        'background-color': 'var(--muted-foreground)',
      },
    }),
    'conversation-turn-current': recipe({
      base: { width: '1rem', 'background-color': 'var(--foreground)' },
    }),
    'conversation-turn-streaming': recipe({
      base: { width: '1rem', 'background-color': 'var(--primary)' },
    }),
    'conversation-turn-approval': recipe({
      base: { width: '1rem', 'background-color': 'var(--zy-warning)' },
    }),
    'conversation-turn-error': recipe({
      base: { width: '1rem', 'background-color': 'var(--destructive)' },
    }),
    'conversation-approval': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-input-border)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
      },
    }),
    'conversation-tool-error': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'color-mix(in oklab, var(--zy-destructive) 24%, var(--zy-border))',
        'background-color': 'color-mix(in oklab, var(--zy-destructive) 6%, transparent)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1.6',
        'font-family': 'var(--zy-style-font-mono)',
        color: 'var(--zy-destructive)',
      },
    }),
    'conversation-tool-params': recipe({
      base: {
        ...border,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--zy-surface)',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'line-height': '1.6',
      },
    }),
    'conversation-stats-trigger': recipe({
      base: {
        ...meta,
        ...motion,
        height: '1.5rem',
        'padding-inline': '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--zy-text-muted)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      focus,
    }),
    'conversation-image-action': recipe({
      base: {
        ...motion,
        'border-width': '0',
        'border-radius': 'var(--zy-style-radius-xl)',
        padding: '0',
        'background-color': 'transparent',
        'outline-style': 'none',
      },
      focus,
    }),
    'conversation-image': recipe({ base: { 'border-radius': 'var(--zy-style-radius-xl)' } }),
    'conversation-image-status': recipe({ base: { ...meta, padding: '1rem' } }),
    'conversation-image-stage': recipe({ base: { padding: '1rem' } }),
    'conversation-notice': recipe({
      base: {
        ...meta,
        ...border,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--card)',
        'padding-inline': '0.625rem',
        'padding-block': '0.375rem',
      },
    }),
    'conversation-drop': recipe({
      base: {
        ...text,
        'border-radius': 'inherit',
        'background-color': 'var(--secondary)',
        'font-weight': '500',
      },
    }),
    'conversation-toolbar-pending': recipe({ base: { opacity: '0.5' } }),
    'conversation-submit-empty': recipe({ base: { opacity: '0.5' } }),
    'fold-panel': recipe({
      base: { ...motion, 'transition-property': 'opacity', 'transition-duration': '200ms' },
      entering: { opacity: '0' },
      exiting: { opacity: '0' },
    }),
    'terminal-root': recipe({
      base: {
        ...border,
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--foreground)',
      },
    }),
    'terminal-header': recipe({
      base: {
        'border-bottom-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
      },
    }),
    'terminal-title': recipe({
      base: {
        ...meta,
        'font-family': 'var(--zy-style-font-mono)',
        color: 'var(--muted-foreground)',
      },
    }),
    'terminal-content': recipe({
      base: {
        ...meta,
        'font-family': 'var(--zy-style-font-mono)',
        padding: '0.75rem',
        'line-height': '1.6',
        color: 'var(--foreground)',
      },
    }),
    'terminal-cursor': recipe({
      base: { width: '0.5rem', height: '1rem', 'background-color': 'var(--foreground)' },
    }),
  };
}
