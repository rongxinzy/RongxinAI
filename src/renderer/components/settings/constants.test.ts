import { expect, test } from 'vitest';

import {
  settingsContentWidthClass,
  settingsFooterMode,
  settingsFooterSecondaryLabel,
} from './constants';

test('auto-saved pages only offer Close instead of a no-op Save', () => {
  for (const tab of ['model', 'aisphere', 'coworkMemory', 'about'] as const) {
    expect(settingsFooterMode(tab), tab).toBe('close');
    expect(settingsFooterSecondaryLabel(tab), tab).toBe('close');
  }
});

test('draft pages keep Cancel and Save', () => {
  for (const tab of ['general', 'appearance', 'shortcuts', 'email'] as const) {
    expect(settingsFooterMode(tab), tab).toBe('draft');
    expect(settingsFooterSecondaryLabel(tab), tab).toBe('cancel');
  }
});

test('IM keeps Save for gateway sync but closes instead of promising rollback', () => {
  expect(settingsFooterMode('im')).toBe('draft');
  expect(settingsFooterSecondaryLabel('im')).toBe('close');
});

test('wide canvases are limited to memory and IM', () => {
  expect(settingsContentWidthClass('coworkMemory')).toBe('max-w-5xl');
  expect(settingsContentWidthClass('im')).toBe('max-w-5xl');
  for (const tab of ['general', 'appearance', 'shortcuts', 'model', 'aisphere'] as const) {
    expect(settingsContentWidthClass(tab), tab).toBe('max-w-3xl');
  }
  expect(settingsContentWidthClass('email')).toBe('max-w-3xl');
  expect(settingsContentWidthClass('about')).toBe('max-w-3xl');
});
