import { expect, test } from 'vitest';

import { formatShortcutLabel } from './shortcutLabel';

test('formats command-or-control shortcuts for macOS', () => {
  expect(formatShortcutLabel('CmdOrCtrl+N', true)).toBe('⌘+N');
});

test('formats command-or-control shortcuts for non-macOS platforms', () => {
  expect(formatShortcutLabel('CmdOrCtrl+N', false)).toBe('Ctrl+N');
  expect(formatShortcutLabel('CmdOrCtrl+F', false)).toBe('Ctrl+F');
  expect(formatShortcutLabel('CmdOrCtrl+,', false)).toBe('Ctrl+,');
});
