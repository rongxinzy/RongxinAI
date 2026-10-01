import { recipe } from './recipe';

export function codingSidebarAppearances() {
  return {
    'coding-session-agent': recipe({
      base: {
        width: 'min(30%, 6.5rem)',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-normal)',
        color: 'var(--muted-foreground)',
      },
    }),
  };
}
