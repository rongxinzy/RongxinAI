import { expect, test } from 'vitest';

import { allThemes } from '../themes';

test.each(allThemes)(
  '$meta.id keeps the session press surface on the whole row',
  ({ components }) => {
    expect(components['shell-sidebar-task'].pressed['background-color']).toBe(
      components['shell-sidebar-task-selected'].base['background-color'],
    );
    expect(components['shell-sidebar-task'].pressed['background-color']).toBe(
      'var(--sidebar-accent)',
    );
    expect(components['shell-sidebar-task-main'].pressed['background-color']).toBe('transparent');
    expect(components['shell-sidebar-task-main'].focus['outline-style']).toBe('solid');
  },
);
