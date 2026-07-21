import { expect, test } from 'vitest';

import { toggleBatchSelection, toggleVisibleBatchSelection } from './batchSelection';

test('toggles one session without changing other selections', () => {
  const selected = new Set(['session-a', 'session-b']);

  expect([...toggleBatchSelection(selected, 'session-a')]).toEqual(['session-b']);
  expect([...toggleBatchSelection(selected, 'session-c')]).toEqual([
    'session-a',
    'session-b',
    'session-c',
  ]);
  expect([...selected]).toEqual(['session-a', 'session-b']);
});

test('selects and deselects only the currently visible sessions', () => {
  const visible = ['session-a', 'session-b'];

  expect([...toggleVisibleBatchSelection(new Set(['hidden-session']), visible)]).toEqual([
    'hidden-session',
    'session-a',
    'session-b',
  ]);
  expect(
    [...toggleVisibleBatchSelection(new Set(['hidden-session', ...visible]), visible)],
  ).toEqual(['hidden-session']);
});
