import { recipe } from './recipe';

/** Miniature interface drawings consume the previewed package's scoped tokens. */
export function classicAppearancePreview() {
  return {
    'appearance-mode-tab': recipe({ base: { opacity: '1' } }),
    'appearance-preview-frame': recipe({ base: {
      'border-radius': 'var(--zy-style-radius-md)',
      'background-color': 'var(--zy-background)',
      'border-width': '1px', 'border-style': 'solid', 'border-color': 'var(--zy-border)',
    } }),
    'appearance-preview-sidebar': recipe({ base: {
      'background-color': 'var(--sidebar)', padding: '0.5rem',
    } }),
    'appearance-preview-main': recipe({ base: { padding: '0.75rem' } }),
    'appearance-preview-line': recipe({ base: {
      height: '0.25rem', 'border-radius': 'var(--zy-style-radius-sm)',
      'background-color': 'var(--zy-text-primary)', opacity: '0.55',
    } }),
    'appearance-preview-muted': recipe({ base: {
      height: '0.25rem', 'border-radius': 'var(--zy-style-radius-sm)',
      'background-color': 'var(--zy-text-secondary)', opacity: '0.3',
    } }),
    'appearance-preview-selection': recipe({ base: {
      height: '0.75rem', 'border-radius': 'var(--zy-style-radius-sm)',
      'background-color': 'var(--zy-surface)',
    } }),
    'appearance-preview-message': recipe({ base: {
      height: '1.25rem', 'border-radius': 'var(--zy-style-radius-sm)',
      'background-color': 'var(--zy-surface-raised)',
    } }),
    'appearance-preview-composer': recipe({ base: {
      height: '2rem', 'border-radius': 'var(--zy-style-radius-lg)', padding: '0.375rem',
      'border-width': '1px', 'border-style': 'solid', 'border-color': 'var(--zy-border)',
      'background-color': 'var(--zy-surface)',
    } }),
    'appearance-preview-send': recipe({ base: {
      width: '0.875rem', height: '0.875rem', 'border-radius': 'var(--zy-style-radius-sm)',
      'background-color': 'var(--zy-primary)',
    } }),
    'appearance-preview-check': recipe({ base: { width: '1rem', height: '1rem' } }),
  };
}
