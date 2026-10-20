import { recipe } from './recipe';
export function classicCompositionControls() {
  const searchGroup = recipe({
    base: { 'background-color': 'transparent', 'box-shadow': 'none' },
    groupFocus: { 'box-shadow': 'none' },
    groupInvalid: { 'box-shadow': 'none' },
  });
  return {
    'expert-search-group': structuredClone(searchGroup),
    'skill-search-group': structuredClone(searchGroup),
    'input-submit': recipe({
      base: {
        'border-radius': '9999px',
        'transition-property': 'background-color, translate',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      pressed: { translate: '0 1px' },
      // Empty/disabled send: neutral selected fill + meta icon, never pale blue.
      disabled: {
        'background-color': 'var(--sidebar-accent)',
        color: 'var(--zy-text-muted)',
        opacity: '1',
      },
    }),
    'local-compact-action': recipe({
      base: {
        height: '2rem',
        'padding-inline': '0.75rem',
        'transition-property': 'background-color, border-color',
        'transition-duration': '200ms',
        'transition-timing-function': 'ease-out',
      },
      hover: { 'background-color': 'var(--muted)' },
    }),
  };
}
