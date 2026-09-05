import { recipe } from './recipe';
/** Conditional appearance branches. Components retain the original state predicates. */
export function classicConditionalControls(dark: boolean) {
  return {
    'page-model-selector-select-trigger-variant-1': recipe({
      base: {
        height: 'auto',
        'border-style': 'none',
        'background-color': 'transparent',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'box-shadow': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      disabled: { opacity: '0.7' },
    }),
    'page-settings-button-variant-1': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 5%, transparent)',
      },
    }),
    'page-settings-button-variant-2': recipe({
      base: { 'border-color': 'var(--zy-border)', opacity: '0.6' },
      hover: { opacity: '0.8' },
    }),
    'page-settings-button-variant-3': recipe({
      base: {
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'transition-property': 'background-color,border-color,opacity',
        'transition-duration': '150ms',
      },
    }),
    'page-settings-button-variant-4': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 5%, transparent)',
      },
    }),
    'page-settings-button-variant-5': recipe({
      base: { 'border-color': 'var(--zy-border)', opacity: '0.6' },
      hover: { opacity: '0.8' },
    }),
    'page-settings-button-variant-6': recipe({
      base: {
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'transition-property': 'background-color,border-color,opacity',
        'transition-duration': '150ms',
      },
    }),
    'page-settings-input-variant-1': recipe({ base: { 'padding-right': '2.5rem' } }),
    'page-settings-input-variant-2': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'page-settings-input-variant-3': recipe({ base: { opacity: '0.5' } }),
    'page-settings-button-variant-7': recipe({
      base: {
        gap: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'background-color': 'transparent',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
      },
    }),
    'page-settings-button-variant-8': recipe({
      base: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-foreground)',
      },
      hover: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-settings-button-variant-9': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-agent-task-row-button-variant-1': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '0.3' },
    }),
    'page-agent-task-row-button-variant-2': recipe({
      base: { color: 'var(--zy-foreground)' },
      parentHover: { opacity: '0.46' },
    }),
    'page-agent-task-row-button-variant-3': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '0.3' },
    }),
    'page-agent-task-row-button-variant-4': recipe({ base: { opacity: '0.46' } }),
    'page-workspace-tree-node-button-variant-1': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '0.3' },
    }),
    'page-workspace-tree-node-button-variant-2': recipe({ base: { opacity: '0.46' } }),
    'page-artifact-badge-button-variant-1': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
        color: 'var(--zy-primary)',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
        color: 'var(--zy-primary)',
      },
    }),
    'page-artifact-badge-button-variant-2': recipe({
      base: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--zy-foreground)',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-artifact-badge-button-variant-3': recipe({
      base: {
        gap: '0.5rem',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        height: 'auto',
      },
    }),
    'page-artifact-panel-button-variant-1': recipe({
      base: {
        color: 'var(--zy-primary)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
      },
    }),
    'page-artifact-panel-button-variant-2': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
      },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--zy-surface)' },
    }),
    'page-artifact-panel-button-variant-3': recipe({
      base: {
        color: 'var(--zy-primary)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
      },
    }),
    'page-artifact-panel-button-variant-4': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--zy-surface)' },
    }),
    'page-artifact-panel-button-variant-5': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-document-renderer-button-variant-1': recipe({
      base: {
        'background-color': 'var(--zy-accent)',
        color: 'var(--zy-accent-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
      hover: { 'background-color': 'var(--zy-accent)', color: 'var(--zy-accent-foreground)' },
    }),
    'page-document-renderer-button-variant-2': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--muted)' },
    }),
    'page-document-renderer-button-variant-3': recipe({
      base: {
        'padding-inline': '0.5rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-xs)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        height: 'auto',
      },
    }),
    'page-text-renderer-button-variant-1': recipe({
      base: {
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
        color: 'var(--zy-primary)',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)',
        color: 'var(--zy-primary)',
      },
    }),
    'page-text-renderer-button-variant-2': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--zy-surface)' },
    }),
    'page-text-renderer-button-variant-3': recipe({
      base: {
        'padding-inline': '0.5rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-xs)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        height: 'auto',
      },
    }),
    'page-chat-skill-shortcuts-button-variant-1': recipe({
      base: {
        gap: '0.5rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'transparent',
        'background-color': 'transparent',
        'padding-inline': '0.75rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
      },
      hover: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-chat-skill-shortcuts-button-variant-2': recipe({
      base: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-foreground)',
      },
      hover: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-chat-skill-shortcuts-button-variant-3': recipe({
      base: { color: 'var(--muted-foreground)' },
    }),
    'page-coding-workspace-sidebar-button-variant-1': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '0.3' },
    }),
    'page-coding-workspace-sidebar-button-variant-2': recipe({ base: { opacity: '0.46' } }),
    'page-coding-workspace-sidebar-button-variant-3': recipe({
      base: {
        height: '2rem',
        width: 'calc(100%+12px)',
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-block': '0rem',
        'padding-right': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'transparent' },
    }),
    'page-coding-workspace-sidebar-button-variant-4': recipe({ base: { 'padding-left': '46px' } }),
    'page-coding-workspace-sidebar-button-variant-5': recipe({ base: { 'padding-left': '38px' } }),
    'page-coding-workspace-sidebar-button-variant-6': recipe({
      base: { color: 'var(--zy-foreground)' },
    }),
    'page-coding-workspace-sidebar-button-variant-7': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-cowork-question-wizard-button-variant-1': recipe({
      base: {
        'border-color': 'var(--zy-success)',
        'background-color': 'color-mix(in oklab, var(--zy-success) 10%, transparent)',
        color: 'var(--zy-success)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--zy-success) 20%, transparent)' },
    }),
    'page-cowork-session-detail-button-variant-1': recipe({ base: { opacity: '0' } }),
    'page-cowork-session-detail-button-variant-2': recipe({ base: { opacity: '0.3' } }),
    'page-cowork-session-detail-button-variant-3': recipe({
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-cowork-session-detail-button-variant-4': recipe({
      base: { height: '1.25rem', width: '1.25rem', color: 'var(--muted-foreground)' },
    }),
    'page-cowork-session-detail-button-variant-5': recipe({ base: { opacity: '0' } }),
    'page-cowork-session-detail-button-variant-6': recipe({ base: { opacity: '0.3' } }),
    'page-cowork-session-detail-button-variant-7': recipe({
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-cowork-session-detail-button-variant-8': recipe({
      base: { height: '1.25rem', width: '1.25rem', color: 'var(--muted-foreground)' },
    }),
    'page-copy-button-button-variant-1': recipe({ base: { opacity: '1' } }),
    'page-copy-button-button-variant-2': recipe({ base: { opacity: '0' } }),
    'page-copy-button-button-variant-3': recipe({ base: { opacity: '1' } }),
    'page-copy-button-button-variant-4': recipe({ base: { opacity: '0' } }),
    'page-imsettings-button-variant-1': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-2': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-3': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-4': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-5': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-6': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-7': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-8': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-9': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-10': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-11': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-12': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-13': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-14': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-15': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-16': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-17': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-18': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-19': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-20': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-21': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-22': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-23': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-24': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-25': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-26': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-27': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-28': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-29': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-30': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-31': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        padding: '0.5rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-32': recipe({
      base: {
        'border-color': 'var(--zy-primary)',
        'background-color': 'var(--zy-primary-muted)',
        'box-shadow': 'var(--zy-style-shadow-subtle)',
      },
    }),
    'page-imsettings-button-variant-33': recipe({
      base: { 'border-color': 'transparent', 'background-color': 'var(--zy-surface)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-imsettings-button-variant-34': recipe({
      base: {
        height: 'auto',
        'border-radius': 'var(--zy-style-radius-lg)',
        padding: '0.375rem',
        'padding-left': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-imsettings-button-variant-35': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-imsettings-button-variant-36': recipe({
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-local-inference-view-button-variant-1': recipe({
      hover: { 'background-color': 'var(--zy-background)' },
    }),
    'page-models-panel-card-variant-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'color-mix(in oklab, var(--zy-border) 70%, transparent)',
        'background-color': 'var(--card)',
        padding: '0rem',
        'box-shadow': 'var(--zy-style-shadow-sm)',
        'transition-property': 'background-color,border-color',
        'transition-duration': '200ms',
      },
    }),
    'page-models-panel-card-variant-2': recipe({
      hover: {
        'border-color': 'var(--zy-border)',
        'background-color': 'color-mix(in oklab, var(--muted) 20%, transparent)',
      },
    }),
    'page-models-panel-card-variant-3': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--muted) 30%, transparent)' },
    }),
    'page-models-panel-card-variant-4': recipe({ base: { opacity: '0.5' } }),
    'page-prompt-panel-button-variant-1': recipe({
      base: {
        'background-color': 'var(--zy-primary-muted)',
        'border-color': 'color-mix(in srgb,var(--zy-primary) 50%,transparent)',
      },
    }),
    'page-prompt-panel-button-variant-2': recipe({
      base: { 'background-color': 'var(--zy-surface)', 'border-color': 'var(--zy-border)' },
      hover: { 'border-color': 'var(--zy-border)', 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-prompt-panel-button-variant-3': recipe({
      base: {
        gap: '0.375rem',
        'padding-inline': '0.875rem',
        'padding-block': '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '200ms',
        height: 'auto',
      },
    }),
    'page-date-input-button-variant-1': recipe({
      base: {
        height: 'auto',
        gap: '0.375rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border-subtle)',
        'background-color': 'var(--zy-surface)',
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-date-input-button-variant-2': recipe({ base: { 'padding-right': '1.5rem' } }),
    'page-date-input-button-variant-3': recipe({
      base: { 'border-color': 'var(--zy-primary)', color: 'var(--zy-foreground)' },
    }),
    'page-date-input-button-variant-4': recipe({
      hover: { 'border-color': 'color-mix(in oklab, var(--zy-primary) 50%, transparent)' },
    }),
    'page-date-input-button-variant-5': recipe({ base: { color: 'var(--zy-foreground)' } }),
    'page-date-input-button-variant-6': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'page-date-input-button-variant-7': recipe({
      base: {
        width: '1.75rem',
        height: '1.75rem',
        'font-size': 'var(--zy-component-text-xs)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        padding: '0rem',
      },
    }),
    'page-date-input-button-variant-8': recipe({
      base: {
        'background-color': 'var(--zy-primary)',
        color: 'var(--zy-primary-foreground)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'page-date-input-button-variant-9': recipe({
      base: { color: 'color-mix(in oklab, var(--muted-foreground) 30%, transparent)' },
    }),
    'page-date-input-button-variant-10': recipe({
      base: { color: 'var(--zy-primary)', 'font-weight': 'var(--zy-component-font-weight-medium)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-date-input-button-variant-11': recipe({
      base: { color: 'var(--zy-foreground)' },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-task-list-card-title-variant-1': recipe({ base: { color: 'var(--zy-foreground)' } }),
    'page-task-list-card-title-variant-2': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'page-provider-model-discovery-button-button-variant-1': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'page-provider-model-discovery-button-button-variant-2': recipe({
      base: { height: 'auto', 'padding-inline': '0rem', 'padding-block': '0rem' },
    }),
    'page-marketplace-skill-grid-card-variant-1': recipe({
      base: {
        'min-height': '5rem',
        gap: '0.75rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        'padding-inline': '1rem',
        'padding-block': '0.75rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'page-marketplace-skill-grid-card-variant-2': recipe({ base: { opacity: '0.5' } }),
    'page-skills-manager-button-variant-1': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { 'background-color': 'var(--muted)', color: 'var(--zy-foreground)' },
    }),
    'page-skills-manager-button-variant-2': recipe({
      base: { 'background-color': 'var(--muted)', color: 'var(--zy-foreground)' },
    }),
    'page-attachments-button-variant-1': recipe({
      base: { height: '1.5rem', width: '1.5rem', 'border-radius': '9999px', padding: '0rem' },
    }),
    'page-attachments-button-variant-2': recipe({
      base: { 'background-color': 'color-mix(in oklab, var(--zy-background) 80%, transparent)' },
    }),
    'page-attachments-button-variant-3': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '1' },
    }),
    'page-attachments-button-variant-4': recipe({
      hover: { 'background-color': 'var(--zy-background)' },
    }),
    'page-attachments-button-variant-5': recipe({
      base: {
        height: '1.25rem',
        width: '1.25rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        padding: '0rem',
      },
    }),
    'page-attachments-button-variant-6': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '1' },
    }),
    'page-attachments-button-variant-7': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        padding: '0rem',
      },
    }),
    'page-chain-of-thought-badge-variant-1': recipe({
      base: {
        gap: '0.25rem',
        'padding-inline': '0.5rem',
        'padding-block': '0.125rem',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-code-block-select-trigger-variant-1': recipe({
      base: {
        height: '1.75rem',
        'border-style': 'none',
        'background-color': 'transparent',
        'padding-inline': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        'box-shadow': 'none',
      },
    }),
    'page-conversation-button-variant-1': recipe(
      dark
        ? {
            base: { 'border-radius': '9999px', 'background-color': 'var(--zy-background)' },
            hover: { 'background-color': 'var(--muted)' },
          }
        : { base: { 'border-radius': '9999px' } },
    ),
    'page-conversation-button-variant-2': recipe(
      dark
        ? {
            base: { 'border-radius': '9999px', 'background-color': 'var(--zy-background)' },
            hover: { 'background-color': 'var(--muted)' },
          }
        : { base: { 'border-radius': '9999px' } },
    ),
    'page-prompt-input-select-trigger-variant-1': recipe({
      base: {
        'border-style': 'none',
        'background-color': 'transparent',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'box-shadow': 'none',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-prompt-input-select-trigger-variant-2': recipe({
      hover: { 'background-color': 'var(--zy-accent)', color: 'var(--zy-foreground)' },
      expanded: { 'background-color': 'var(--zy-accent)', color: 'var(--zy-foreground)' },
    }),
    'page-queue-button-variant-1': recipe({
      base: {
        height: 'auto',
        width: 'auto',
        'border-radius': 'var(--zy-style-radius-sm)',
        padding: '0.25rem',
        color: 'var(--muted-foreground)',
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--muted-foreground) 10%, transparent)',
        color: 'var(--zy-foreground)',
      },
      parentHover: { opacity: '1' },
    }),
    'page-queue-button-variant-2': recipe({
      base: {
        height: 'auto',
        'background-color': 'color-mix(in oklab, var(--muted) 40%, transparent)',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'page-suggestion-button-variant-1': recipe({
      base: { 'border-radius': '9999px', 'padding-inline': '1rem' },
    }),
    'page-terminal-button-variant-1': recipe({
      base: { height: '1.75rem', width: '1.75rem', color: 'var(--zy-component-palette-zinc-400)' },
      hover: {
        'background-color': 'var(--zy-component-palette-zinc-800)',
        color: 'var(--zy-component-palette-zinc-100)',
      },
    }),
    'page-terminal-button-variant-2': recipe({
      base: { height: '1.75rem', width: '1.75rem', color: 'var(--zy-component-palette-zinc-400)' },
      hover: {
        'background-color': 'var(--zy-component-palette-zinc-800)',
        color: 'var(--zy-component-palette-zinc-100)',
      },
    }),
    'page-command-dialog-content-variant-1': recipe({
      base: { 'border-radius': 'var(--zy-style-radius-xl)', padding: '0rem' },
    }),
    'page-sidebar-input-variant-1': recipe({
      base: { height: '2rem', 'background-color': 'var(--zy-background)', 'box-shadow': 'none' },
    }),
  };
}
