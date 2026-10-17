import { expect, test } from 'vitest';

import { settingsContentWidthClass } from './constants';

test('wide canvases are limited to memory and IM', () => {
  expect(settingsContentWidthClass('coworkMemory')).toBe('max-w-5xl');
  expect(settingsContentWidthClass('im')).toBe('max-w-5xl');
  for (const tab of ['general', 'appearance', 'shortcuts', 'model', 'aisphere'] as const) {
    expect(settingsContentWidthClass(tab), tab).toBe('max-w-3xl');
  }
  expect(settingsContentWidthClass('email')).toBe('max-w-3xl');
  expect(settingsContentWidthClass('about')).toBe('max-w-3xl');
});
