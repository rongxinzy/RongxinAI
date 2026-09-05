import { recipe } from './recipe';
/** Page-specific compositions, extracted without moving event handlers or application state. */
export function classicPartControls(dark: boolean) {
  void dark;
  return {
    'part-coding-agent-manager-dialog-header-1': recipe({
      base: {
        'border-bottom-width': '1px',
        'border-color': 'var(--zy-border)',
        'padding-inline': '1.5rem',
        'padding-block': '1.25rem',
        'padding-right': '3.5rem',
      },
    }),
    'part-coding-agent-manager-dialog-footer-1': recipe({
      base: {
        'border-radius': '0px',
        'background-color': 'var(--zy-background)',
        'padding-inline': '1.5rem',
        'padding-block': '1rem',
      },
    }),
    'part-session-expert-picker-command-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-surface)',
      },
    }),
    'part-expert-detail-dialog-dialog-header-1': recipe({
      base: {
        gap: '0.75rem',
        'border-bottom-width': '1px',
        'border-color': 'var(--zy-border)',
        'padding-inline': '1.5rem',
        'padding-block': '1rem',
      },
    }),
    'part-expert-detail-dialog-dialog-title-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-base)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'part-expert-detail-dialog-dialog-footer-1': recipe({
      base: { 'border-radius': '0px', 'padding-inline': '1.5rem', 'padding-block': '1rem' },
    }),
    'part-model-context-settings-modal-input-group-input-1': recipe({
      base: {
        height: '1.75rem',
        width: '2.5rem',
        'padding-left': '0.25rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
      },
    }),
    'part-model-context-settings-modal-input-group-text-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'line-height': '1.25rem',
        color: 'var(--zy-foreground)',
      },
    }),
    'part-marketplace-panel-input-group-input-1': recipe({
      base: { 'font-size': 'var(--zy-component-text-xs)' },
    }),
    'part-marketplace-panel-select-value-1': recipe({
      base: {
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--zy-foreground)',
      },
    }),
    'part-run-session-modal-dialog-header-1': recipe({
      base: {
        'padding-inline': '1.25rem',
        'padding-block': '0.75rem',
        'border-bottom-width': '1px',
        'border-color': 'var(--zy-border)',
      },
    }),
    'part-run-session-modal-dialog-title-1': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
      },
    }),
    'part-skills-popover-command-1': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        'background-color': 'var(--zy-surface)',
      },
    }),
  };
}
