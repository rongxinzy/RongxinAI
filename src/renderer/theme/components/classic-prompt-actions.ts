import { recipe } from './recipe';
export function classicPromptActions() {
  const shadow = { 'box-shadow': 'var(--zy-style-shadow-subtle)' };
  const compact = { 'padding-inline': '0.5rem', 'font-size': 'var(--zy-component-text-sm)' };
  const sidebar = {
    'background-color': 'color-mix(in srgb, var(--zy-text-primary) 4%, transparent)',
  };
  return {
    'fold-compact': recipe({
      base: {
        'border-radius': 'var(--zy-style-radius-md)',
        padding: '0.25rem',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
    'fold-settings': recipe({
      base: {
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'padding-inline': '0.625rem',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { 'background-color': 'var(--zy-surface-raised)' },
      focused: {
        'outline-style': 'none',
        'box-shadow': '0 0 0 2px var(--background), 0 0 0 4px var(--primary)',
      },
    }),
    'fold-reasoning': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
      hover: { color: 'var(--foreground)' },
    }),
    'prompt-compact-action': recipe({
      base: compact,
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'prompt-raised-action': recipe({ hover: shadow, expanded: shadow }),
    'prompt-hover-action': recipe({ hover: shadow }),
    'prompt-folder-action': recipe({ base: compact, hover: shadow, expanded: shadow }),
    'prompt-folder-warning': recipe({
      base: { 'box-shadow': '0 0 0 1px var(--zy-warning)', color: 'var(--zy-warning)' },
      hover: { 'box-shadow': '0 0 0 1px var(--zy-warning), var(--zy-style-shadow-subtle)' },
      expanded: { 'box-shadow': '0 0 0 1px var(--zy-warning), var(--zy-style-shadow-subtle)' },
    }),
    'prompt-expert-chip': recipe({
      base: {
        ...compact,
        height: '1.75rem',
        'border-radius': '9999px',
        'background-color': 'transparent',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'transition-property': 'color, background-color, border-color, box-shadow',
        'transition-duration': '150ms',
      },
    }),
    'prompt-skills-action': recipe({
      base: { color: 'var(--muted-foreground)' },
      hover: { 'background-color': 'var(--zy-surface-raised)', color: 'var(--primary)' },
    }),
    'sidebar-common-surface': recipe({ hover: sidebar, expanded: sidebar }),
    'sidebar-common-active': recipe({ base: sidebar }),
    'sidebar-common-inactive': recipe({
      base: { 'background-color': 'transparent', color: 'var(--zy-text-secondary)' },
    }),
  };
}
