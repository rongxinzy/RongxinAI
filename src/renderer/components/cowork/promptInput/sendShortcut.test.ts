import { describe, expect, test } from 'vitest';

import { matchesSendShortcut, type SendShortcutModifiers } from './sendShortcut';

const modifiers = (overrides: Partial<SendShortcutModifiers>): SendShortcutModifiers => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...overrides,
});

describe('matchesSendShortcut', () => {
  test('bare Enter only matches with no modifiers held', () => {
    expect(matchesSendShortcut(modifiers({}), 'Enter')).toBe(true);
    expect(matchesSendShortcut(modifiers({ shiftKey: true }), 'Enter')).toBe(false);
    expect(matchesSendShortcut(modifiers({ ctrlKey: true }), 'Enter')).toBe(false);
    expect(matchesSendShortcut(modifiers({ metaKey: true }), 'Enter')).toBe(false);
    expect(matchesSendShortcut(modifiers({ altKey: true }), 'Enter')).toBe(false);
  });

  test('Shift+Enter requires shift without other modifiers', () => {
    expect(matchesSendShortcut(modifiers({ shiftKey: true }), 'Shift+Enter')).toBe(true);
    expect(matchesSendShortcut(modifiers({ shiftKey: true, ctrlKey: true }), 'Shift+Enter')).toBe(
      false,
    );
    expect(matchesSendShortcut(modifiers({}), 'Shift+Enter')).toBe(false);
  });

  test('Ctrl+Enter maps to Cmd on mac and Ctrl elsewhere', () => {
    expect(matchesSendShortcut(modifiers({ ctrlKey: true }), 'Ctrl+Enter', false)).toBe(true);
    expect(matchesSendShortcut(modifiers({ metaKey: true }), 'Ctrl+Enter', false)).toBe(false);
    expect(matchesSendShortcut(modifiers({ metaKey: true }), 'Ctrl+Enter', true)).toBe(true);
    expect(matchesSendShortcut(modifiers({ ctrlKey: true }), 'Ctrl+Enter', true)).toBe(false);
    expect(
      matchesSendShortcut(modifiers({ ctrlKey: true, shiftKey: true }), 'Ctrl+Enter', false),
    ).toBe(false);
  });

  test('Alt+Enter requires alt without other modifiers', () => {
    expect(matchesSendShortcut(modifiers({ altKey: true }), 'Alt+Enter')).toBe(true);
    expect(matchesSendShortcut(modifiers({ altKey: true, ctrlKey: true }), 'Alt+Enter')).toBe(
      false,
    );
    expect(matchesSendShortcut(modifiers({}), 'Alt+Enter')).toBe(false);
  });

  test('unknown config values fall back to bare Enter', () => {
    expect(matchesSendShortcut(modifiers({}), 'Ctrl+Shift+Enter')).toBe(true);
    expect(matchesSendShortcut(modifiers({ shiftKey: true }), 'Ctrl+Shift+Enter')).toBe(false);
  });
});
