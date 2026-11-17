import { recipe } from './recipe';
export function classicPromptActions() {
  const raised = { 'background-color': 'var(--zy-surface-raised)', 'box-shadow': 'none' };
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
        'min-height': '2rem',
        'padding-inline': '0.5rem',
        'padding-block': '0.25rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)', color: 'var(--foreground)' },
      focused: {
        'outline-style': 'solid',
        'outline-width': '2px',
        'outline-color': 'var(--ring)',
        'outline-offset': '1px',
      },
    }),
    'prompt-compact-action': recipe({
      base: compact,
      hover: { 'background-color': 'var(--zy-surface-raised)' },
    }),
    'prompt-raised-action': recipe({ hover: raised, expanded: raised }),
    'prompt-hover-action': recipe({ hover: raised }),
    'prompt-folder-action': recipe({ base: compact, hover: raised, expanded: raised }),
    'prompt-folder-warning': recipe({
      base: { 'box-shadow': '0 0 0 1px var(--zy-warning)', color: 'var(--zy-warning)' },
      hover: { 'box-shadow': '0 0 0 1px var(--zy-warning)' },
      expanded: { 'box-shadow': '0 0 0 1px var(--zy-warning)' },
    }),
    'prompt-expert-chip': recipe({
      base: {
        ...compact,
        height: '2rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'background-color': 'transparent',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'transition-property': 'color, background-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      hover: { 'background-color': 'var(--accent)' },
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
