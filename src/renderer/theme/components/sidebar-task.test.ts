import { expect, test } from 'vitest';

import { zenithDark } from '../themes/zenith-dark';
import { zenithLight } from '../themes/zenith-light';

test.each([zenithLight, zenithDark])(
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
