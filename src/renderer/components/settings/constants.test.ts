import { expect, test } from 'vitest';

import { settingsContentWidthClass } from './constants';

test('wide canvases are limited to memory and usage', () => {
  expect(settingsContentWidthClass('memory')).toBe('max-w-5xl');
  expect(settingsContentWidthClass('usage')).toBe('max-w-5xl');
  expect(settingsContentWidthClass('coworkMemory')).toBe('max-w-5xl');
  for (const tab of [
    'general',
    'appearance',
    'companion',
    'shortcuts',
    'models',
    'privacy',
    'channels',
    'advanced',
    'about',
  ] as const) {
    expect(settingsContentWidthClass(tab), tab).toBe('max-w-3xl');
  }
});
