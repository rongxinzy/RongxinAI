import { expect, test } from 'vitest';

import { COMPANION_SHORTCUT } from '../../shared/companion/constants';
import { formatShortcutLabel } from './shortcutLabel';

test('formats command-or-control shortcuts for macOS', () => {
  expect(formatShortcutLabel('CmdOrCtrl+N', true)).toBe('⌘+N');
});

test('formats command-or-control shortcuts for non-macOS platforms', () => {
  expect(formatShortcutLabel('CmdOrCtrl+N', false)).toBe('Ctrl+N');
  expect(formatShortcutLabel('CmdOrCtrl+F', false)).toBe('Ctrl+F');
  expect(formatShortcutLabel('CmdOrCtrl+,', false)).toBe('Ctrl+,');
});

test('formats the registered companion shortcut on macOS and Windows', () => {
  expect(formatShortcutLabel(COMPANION_SHORTCUT, true)).toBe('⌘+Shift+Space');
  expect(formatShortcutLabel(COMPANION_SHORTCUT, false)).toBe('Ctrl+Shift+Space');
});
