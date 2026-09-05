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
        'transition-property': 'scale',
        'transition-duration': '150ms',
        'transition-timing-function': 'ease-out',
      },
      hover: { scale: '1.05' },
      pressed: { scale: '0.95' },
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
