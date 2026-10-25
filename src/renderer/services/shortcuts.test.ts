import { expect, test } from 'vitest';

import { COMPANION_SHORTCUT } from '../../shared/companion/constants';
import { shortcutsConflict } from './shortcuts';

test('reserves the companion shortcut for the platform-specific recorder keys', () => {
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Cmd+Shift+Space', true)).toBe(true);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Ctrl+Shift+Space', false)).toBe(true);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Ctrl+Shift+Space', true)).toBe(false);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Cmd+Shift+Space', false)).toBe(false);
});

test('detects existing bindings despite alias, case and modifier order', () => {
  expect(shortcutsConflict('CmdOrCtrl+N', 'n+Command', true)).toBe(true);
  expect(shortcutsConflict('CmdOrCtrl+,', 'control+comma', false)).toBe(true);
  expect(shortcutsConflict('Shift+Command+Spacebar', COMPANION_SHORTCUT, true)).toBe(true);
});

test('allows clearing and distinct keys or modifiers', () => {
  expect(shortcutsConflict(COMPANION_SHORTCUT, '', true)).toBe(false);
  expect(shortcutsConflict(undefined, COMPANION_SHORTCUT, true)).toBe(false);
  expect(shortcutsConflict('CmdOrCtrl', COMPANION_SHORTCUT, true)).toBe(false);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Cmd+Space', true)).toBe(false);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Cmd+Shift+K', true)).toBe(false);
  expect(shortcutsConflict(COMPANION_SHORTCUT, 'Cmd+Alt+Shift+Space', true)).toBe(false);
});
