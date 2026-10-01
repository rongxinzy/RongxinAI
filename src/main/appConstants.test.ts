import { describe, expect, test } from 'vitest';

import {
  APP_DATA_DIR_NAME,
  ENTERPRISE_APP_DATA_DIR_NAME,
  resolveAppDataDirName,
} from './appConstants';

describe('resolveAppDataDirName', () => {
  test('keeps community builds on the shared ZhiYuanAgent data root', () => {
    expect(resolveAppDataDirName(false)).toBe(APP_DATA_DIR_NAME);
  });

  test('isolates enterprise builds into their own data root', () => {
    expect(resolveAppDataDirName(true)).toBe(ENTERPRISE_APP_DATA_DIR_NAME);
    expect(ENTERPRISE_APP_DATA_DIR_NAME).not.toBe(APP_DATA_DIR_NAME);
  });
});
