import { delimiter } from 'path';
import { describe, expect, test } from 'vitest';

import { appendEnvPath } from './pathUtils';

describe('appendEnvPath', () => {
  test('prepends additions before the current value', () => {
    expect(
      appendEnvPath(`${delimiter}usr${delimiter}bin`, [`${delimiter}opt${delimiter}homebrew`]),
    ).toBe(`${delimiter}opt${delimiter}homebrew${delimiter}usr${delimiter}bin`);
  });

  test('drops duplicate and empty entries while keeping first occurrence', () => {
    expect(appendEnvPath('/a', ['/a', '', '/b'])).toBe('/a:/b');
  });

  test('returns the current value unchanged when additions are empty entries', () => {
    expect(appendEnvPath('/a', ['', ''])).toBe('/a');
  });

  test('keeps undefined current value undefined when nothing is added', () => {
    expect(appendEnvPath(undefined, [''])).toBeUndefined();
  });

  test('builds a value from additions alone when current is undefined', () => {
    expect(appendEnvPath(undefined, ['/a', '/b'])).toBe('/a:/b');
  });
});
