import { recipe } from './recipe';
/** Page-specific compositions, extracted without moving event handlers or application state. */
export function classicPageControls(dark: boolean) {
  return {
    'page-code-block-button-1': recipe({
      base: {
        height: '1.75rem',
        width: '1.75rem',
        'border-radius': 'var(--zy-style-radius-md)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--zy-foreground)' },
    }),
    'page-lazy-chunk-error-boundary-button-1': recipe({
      base: { gap: '0.5rem', color: 'var(--muted-foreground)' },
    }),
    'page-login-button-button-1': recipe(
      dark
        ? {
            base: {
              height: '2rem',
              gap: '0.5rem',
              'border-radius': 'var(--zy-style-radius-lg)',
              'padding-inline': '0.5rem',
              'font-size': 'var(--zy-component-text-sm)',
              'font-weight': 'var(--zy-component-font-weight-normal)',
              color: 'var(--muted-foreground)',
              'transition-property': 'color, background-color, border-color, box-shadow',
              'transition-duration': '150ms',
            },
            hover: {
              'background-color':
                'color-mix(in oklab, var(--zy-component-palette-white) 4%, transparent)',
            },
          }
        : {
            base: {
              height: '2rem',
              gap: '0.5rem',
              'border-radius': 'var(--zy-style-radius-lg)',
              'padding-inline': '0.5rem',
              'font-size': 'var(--zy-component-text-sm)',
              'font-weight': 'var(--zy-component-font-weight-normal)',
              color: 'var(--muted-foreground)',
              'transition-property': 'color, background-color, border-color, box-shadow',
              'transition-duration': '150ms',
            },
            hover: {
              'background-color':
                'color-mix(in oklab, var(--zy-component-palette-black) 3%, transparent)',
            },
          },
    ),
    'page-login-button-button-2': recipe({
      base: {
        height: '2.25rem',
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--zy-destructive)',
      },
      hover: { color: 'var(--zy-destructive)' },
    }),
    'page-markdown-content-button-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.125rem',
        height: 'auto',
        width: 'auto',
        color: 'var(--muted-foreground)',
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
      },
      hover: { color: 'var(--zy-primary)', 'background-color': 'var(--zy-surface-raised)' },
      parentHover: { opacity: '1' },
      parentFocus: { opacity: '1' },
    }),
    'page-settings-button-1': recipe({
      base: {
        opacity: '0',
        'transition-property': 'opacity',
        'transition-duration': '150ms',
        color: 'var(--muted-foreground)',
        height: 'auto',
        width: 'auto',
        padding: '0.125rem',
      },
      parentHover: { opacity: '1' },
      hover: { color: 'var(--zy-destructive)' },
    }),
    'page-settings-button-2': recipe({
      base: {
        'border-style': 'dashed',
        'border-color': 'var(--zy-border)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'border-color': 'var(--zy-primary)', color: 'var(--zy-primary)' },
    }),
    'page-settings-button-3': recipe({
      base: {
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        height: 'auto',
      },
    }),
    'page-settings-button-4': recipe({
      base: {
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        height: 'auto',
      },
    }),
    'page-settings-button-5': recipe({
      base: {
        gap: '0.5rem',
        'padding-inline': '1rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-xs)',
        height: 'auto',
      },
    }),
    'page-settings-button-6': recipe({
      base: {
        height: 'auto',
        'padding-inline': '0.5rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-settings-button-7': recipe({
      base: {
        height: 'auto',
        'padding-inline': '0rem',
        'padding-block': '0rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-settings-input-1': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'page-settings-button-8': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-settings-button-9': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-destructive)' },
    }),
    'page-settings-button-10': recipe({
      base: { height: '1.25rem', width: '1.25rem', color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-settings-input-2': recipe({
      base: { width: '5rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'page-settings-input-3': recipe({
      base: { width: '5rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'page-settings-input-4': recipe({ base: { 'font-size': 'var(--zy-component-text-sm)' } }),
    'page-settings-textarea-1': recipe({
      base: {
        'min-height': '280px',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'line-height': '1.625',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-settings-button-11': recipe({
      base: {
        color: 'var(--muted-foreground)',
        padding: '0.375rem',
        'border-radius': 'var(--zy-style-radius-lg)',
      },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-sidebar-button-1': recipe({
      base: {
        gap: '0.25rem',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'border-radius': 'var(--zy-style-radius-lg)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'page-sidebar-button-2': recipe({
      base: {
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-agent-task-row-input-1': recipe({
      base: {
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-background)',
        'padding-inline': '0.375rem',
        'padding-block': '0.125rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
    }),
    'page-expand-agent-tasks-row-button-1': recipe({
      base: {
        height: '1.75rem',
        width: 'calc(100%+12px)',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-left': '38px',
        'padding-right': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-foreground)',
        opacity: '0.28',
      },
      disabled: { opacity: '0.6' },
    }),
    'page-my-agent-sidebar-tree-button-1': recipe({
      base: {
        height: 'auto',
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-workspace-tree-node-button-1': recipe({
      base: {
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-block': '0rem',
        'padding-left': '0.75rem',
        'padding-right': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-foreground)',
      },
      hover: { 'background-color': 'transparent' },
      expanded: { 'background-color': 'transparent' },
    }),
    'page-workspace-tree-node-button-2': recipe({
      base: {
        height: '1.75rem',
        width: 'calc(100%+12px)',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-left': '38px',
        'padding-right': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-destructive)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--zy-destructive) 10%, transparent)' },
    }),
    'page-artifact-preview-card-button-1': recipe({
      base: {
        gap: '0.75rem',
        'padding-inline': '1rem',
        'padding-block': '0.75rem',
        'border-radius': 'var(--zy-style-radius-xl)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface-raised)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        height: 'auto',
      },
      hover: { 'background-color': 'var(--zy-surface-tertiary)' },
    }),
    'page-file-directory-view-input-1': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'page-document-renderer-button-1': recipe({
      base: {
        'padding-inline': '0.75rem',
        'padding-block': '0.375rem',
        'font-size': 'var(--zy-component-text-xs)',
        height: 'auto',
      },
    }),
    'page-mermaid-renderer-button-1': recipe({
      base: {
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-model-renderer-button-1': recipe({
      base: {
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-coding-activity-view-badge-1': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'page-coding-workspace-sidebar-button-1': recipe({
      base: {
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-block': '0rem',
        'padding-left': '0.75rem',
        'padding-right': '0.5rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-foreground)',
      },
      hover: { 'background-color': 'transparent' },
    }),
    'page-coding-workspace-sidebar-button-2': recipe({
      base: {
        height: '2rem',
        width: 'calc(100%+12px)',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-left': '38px',
        'padding-right': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
      hover: { 'background-color': 'transparent', color: 'var(--zy-foreground)' },
    }),
    'page-coding-workspace-sidebar-button-3': recipe({
      base: { opacity: '0', 'transition-property': 'opacity', 'transition-duration': '150ms' },
      parentHover: { opacity: '0.3' },
    }),
    'page-active-expert-badge-button-1': recipe({
      base: { height: '1rem', width: '1rem', 'border-radius': '9999px', padding: '0rem' },
      hover: { 'background-color': 'transparent' },
    }),
    'page-ask-user-question-card-textarea-1': recipe({
      base: { 'min-height': '4rem', 'font-size': 'var(--zy-component-text-sm)' },
    }),
    'page-cowork-prompt-input-button-1': recipe({
      base: { height: '1rem', width: '1rem', 'border-radius': '9999px', padding: '0rem' },
      hover: { 'background-color': 'transparent' },
    }),
    'page-create-project-dialog-input-1': recipe({ base: { color: 'var(--muted-foreground)' } }),
    'page-embedding-settings-section-button-1': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)', height: 'auto', padding: '0rem' },
    }),
    'page-image-preview-modal-button-1': recipe({
      base: { color: 'color-mix(in oklab, var(--zy-component-palette-white) 80%, transparent)' },
      hover: {
        'background-color':
          'color-mix(in oklab, var(--zy-component-palette-white) 15%, transparent)',
        color: 'var(--zy-component-palette-white)',
      },
    }),
    'page-session-expert-picker-popover-content-1': recipe({
      base: {
        width: '20rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-surface)',
        padding: '0rem',
        'box-shadow': 'var(--zy-style-shadow-md)',
        'outline-style': 'none',
      },
    }),
    'page-tool-card-button-1': recipe({
      base: {
        gap: '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
        color: 'var(--muted-foreground)',
      },
    }),
    'page-preset-expert-list-card-1': recipe({
      base: {
        'min-height': '5rem',
        gap: '0.75rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        padding: '1rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'page-preset-expert-list-button-1': recipe({
      base: {
        height: 'auto',
        width: 'auto',
        'border-radius': 'inherit',
        'border-width': '0px',
        padding: '0rem',
      },
      hover: { 'background-color': 'transparent' },
    }),
    'page-feishu-instance-settings-button-1': recipe({
      base: {
        height: 'auto',
        padding: '0rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'text-decoration': 'underline',
        'text-underline-offset': '2px',
      },
    }),
    'page-common-button-1': recipe({
      base: { color: 'color-mix(in oklab, var(--zy-foreground) 70%, transparent)' },
      hover: { color: 'var(--zy-foreground)' },
    }),
    'page-marketplace-download-sidebar-badge-1': recipe({
      base: {
        height: '1.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.5rem',
        'padding-block': '0rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
      },
    }),
    'page-runtime-install-card-card-1': recipe({
      base: {
        gap: '0.5rem',
        'border-color': 'color-mix(in oklab, var(--zy-primary) 20%, transparent)',
        'background-color': 'color-mix(in oklab, var(--zy-primary) 3%, transparent)',
      },
    }),
    'page-runtime-install-card-card-footer-1': recipe({
      base: {
        gap: '0.5rem',
        'border-width': '0px',
        'background-color': 'transparent',
        padding: '0rem',
        'padding-bottom': '0.5rem',
      },
    }),
    'page-marketplace-panel-select-trigger-1': recipe({
      base: { 'border-color': 'var(--zy-border-subtle)', 'background-color': 'var(--zy-surface)' },
    }),
    'page-models-panel-card-title-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.5rem',
        color: 'var(--zy-foreground)',
      },
    }),
    'page-model-launch-log-window-badge-1': recipe({
      base: {
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--muted)',
        color: 'var(--muted-foreground)',
      },
    }),
    'page-model-launch-log-window-badge-2': recipe({
      base: {
        'border-color': 'color-mix(in srgb,var(--zy-success) 28%,transparent)',
        'background-color': 'color-mix(in srgb,var(--zy-success) 12%,transparent)',
        color: 'var(--zy-success)',
      },
    }),
    'page-model-launch-log-window-badge-3': recipe({
      base: {
        'border-color': 'color-mix(in srgb,var(--zy-destructive) 28%,transparent)',
        'background-color': 'color-mix(in srgb,var(--zy-destructive) 12%,transparent)',
        color: 'var(--zy-destructive)',
      },
    }),
    'page-model-launch-log-window-badge-4': recipe({
      base: {
        'border-color': 'color-mix(in srgb,var(--zy-primary) 28%,transparent)',
        'background-color': 'var(--zy-primary-muted)',
        color: 'var(--zy-primary)',
      },
    }),
    'page-active-mcp-badge-dropdown-menu-item-1': recipe({
      focused: { 'background-color': 'transparent' },
      focus: { 'background-color': 'var(--muted)' },
      hover: { 'background-color': 'var(--muted)' },
      focusHover: { 'background-color': 'var(--muted)' },
    }),
    'page-mcp-manager-button-1': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-mcp-manager-button-2': recipe({
      base: {
        height: '1.75rem',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-mcp-manager-button-3': recipe({
      base: {
        height: 'auto',
        'min-height': '8rem',
        'border-style': 'dashed',
        color: 'var(--muted-foreground)',
      },
    }),
    'page-mcp-manager-button-4': recipe({
      base: { height: '1.75rem', width: '1.75rem', color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-primary)' },
    }),
    'page-mcp-manager-button-5': recipe({
      base: { height: '1.75rem', width: '1.75rem', color: 'var(--muted-foreground)' },
      hover: { color: 'var(--zy-destructive)' },
    }),
    'page-quick-action-bar-button-1': recipe({
      base: {
        gap: '0.5rem',
        'padding-inline': '0.75rem',
        'padding-block': '0.5rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
        'background-color': 'var(--zy-surface)',
        'border-color': 'var(--zy-border)',
        color: 'var(--muted-foreground)',
      },
      hover: {
        'background-color': 'var(--zy-surface-raised)',
        'border-color': 'color-mix(in oklab, var(--zy-primary) 40%, transparent)',
      },
    }),
    'page-run-session-modal-dialog-content-1': recipe({
      base: {
        width: 'min(56rem,calc(100%-2rem))',
        gap: '0rem',
        'background-color': 'var(--card)',
        padding: '0rem',
      },
    }),
    'page-task-list-card-1': recipe({
      base: {
        gap: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        padding: '0.75rem',
      },
    }),
    'page-task-template-gallery-card-1': recipe({
      hover: {
        'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
      base: {
        'transition-property': 'background-color,box-shadow',
        'transition-duration': '150ms',
        'box-shadow': 'var(--zy-style-shadow-sm)',
      },
    }),
    'page-task-template-gallery-card-2': recipe({
      base: {
        'border-style': 'dashed',
        'transition-property': 'background-color,box-shadow',
        'transition-duration': '150ms',
      },
      hover: {
        'background-color': 'color-mix(in oklab, var(--muted) 50%, transparent)',
        'box-shadow': 'var(--zy-style-shadow-md)',
      },
    }),
    'page-pi-runtime-model-config-select-trigger-1': recipe({
      base: { height: '2rem', width: '8rem', 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'page-pi-runtime-model-config-select-trigger-2': recipe({
      base: { height: '2rem', width: '6rem', 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'page-active-skill-badge-button-1': recipe({
      base: { height: '1rem', width: '1rem', 'border-radius': '9999px' },
      hover: { 'background-color': 'var(--zy-background)' },
    }),
    'page-installed-skill-grid-card-1': recipe({
      base: {
        'min-height': '5rem',
        gap: '0.75rem',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--card)',
        padding: '1rem',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
        'box-shadow': 'none',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'page-installed-skill-grid-button-1': recipe({
      base: {
        height: 'auto',
        width: 'auto',
        'border-radius': 'inherit',
        'border-width': '0px',
        padding: '0rem',
      },
      hover: { 'background-color': 'transparent' },
    }),
    'page-marketplace-skill-grid-button-1': recipe({
      base: {
        height: 'auto',
        gap: '0.5rem',
        'border-width': '0px',
        'padding-inline': '0rem',
        'padding-block': '0.25rem',
      },
      hover: { 'background-color': 'transparent' },
    }),
    'page-skill-document-dialog-button-1': recipe({
      base: { color: 'var(--zy-destructive)' },
      hover: { color: 'var(--zy-destructive)' },
    }),
    'page-skill-security-report-button-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-skill-security-report-button-2': recipe({
      base: {
        'padding-inline': '0.875rem',
        'padding-block': '0.625rem',
        height: 'auto',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-skills-manager-button-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { color: 'var(--zy-foreground)', 'background-color': 'var(--zy-surface-raised)' },
    }),
    'page-skills-manager-input-1': recipe({
      base: {
        'padding-inline': '0.75rem',
        'padding-block': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'border-radius': 'var(--zy-style-radius-xl)',
        'background-color': 'var(--zy-background)',
        color: 'var(--zy-foreground)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
      },
    }),
    'page-skills-manager-button-2': recipe({
      base: {
        'padding-block': '0.625rem',
        color: 'var(--zy-primary-foreground)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      disabled: { opacity: '0.5' },
    }),
    'page-skills-popover-popover-content-1': recipe({
      base: {
        width: '18rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'var(--zy-border)',
        'background-color': 'var(--zy-surface)',
        padding: '0rem',
        'box-shadow': 'var(--zy-style-shadow-md)',
        'outline-style': 'none',
      },
    }),
    'page-skills-popover-button-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '1rem',
        'padding-block': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--zy-foreground)' },
    }),
    'page-todo-task-detail-input-1': recipe({
      base: {
        height: '2.5rem',
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
      },
    }),
    'page-todo-view-input-1': recipe({
      base: {
        'border-width': '0px',
        'background-color': 'transparent',
        'padding-inline': '0rem',
        'box-shadow': 'none',
      },
      focus: { 'box-shadow': 'none' },
    }),
    'page-app-update-badge-button-1': recipe({
      base: {
        height: '2rem',
        gap: '0.5rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'padding-inline': '0.375rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--zy-primary)',
      },
      hover: { 'background-color': 'color-mix(in oklab, var(--zy-primary) 10%, transparent)' },
    }),
    'page-window-title-bar-button-1': recipe({
      base: {
        height: '2rem',
        width: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        color: 'color-mix(in oklab, var(--zy-foreground) 60%, transparent)',
      },
      hover: {
        'background-color': 'var(--zy-destructive)',
        color: 'var(--zy-destructive-foreground)',
      },
    }),
    'page-confirmation-button-1': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.75rem',
        'font-size': 'var(--zy-component-text-sm)',
      },
    }),
    'page-tool-badge-1': recipe({
      base: {
        gap: '0.375rem',
        'border-radius': '9999px',
        'font-size': 'var(--zy-component-text-xs)',
      },
    }),
    'page-sidebar-sheet-content-1': recipe({
      base: {
        'background-color': 'var(--sidebar)',
        padding: '0rem',
        color: 'var(--sidebar-foreground)',
      },
    }),
  };
}
