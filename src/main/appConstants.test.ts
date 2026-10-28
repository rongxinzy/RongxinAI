import { describe, expect, test } from 'vitest';

import {
  APP_DATA_DIR_NAME,
  DEV_APP_DATA_DIR_SUFFIX,
  ENTERPRISE_APP_DATA_DIR_NAME,
  resolveAppDataDirName,
  resolveUserDataDirName,
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

describe('resolveUserDataDirName', () => {
  test('isolates unpackaged builds from the installed profile', () => {
    expect(
      resolveUserDataDirName({ isEnterprise: false, isPackaged: false, sharedDevData: false }),
    ).toBe(`${APP_DATA_DIR_NAME}${DEV_APP_DATA_DIR_SUFFIX}`);
  });

  test('keeps packaged builds on the product data root', () => {
    expect(
      resolveUserDataDirName({ isEnterprise: false, isPackaged: true, sharedDevData: false }),
    ).toBe(APP_DATA_DIR_NAME);
  });

  test('lets unpackaged builds opt into the installed profile', () => {
    expect(
      resolveUserDataDirName({ isEnterprise: false, isPackaged: false, sharedDevData: true }),
    ).toBe(APP_DATA_DIR_NAME);
  });

  test('isolates enterprise development builds as well', () => {
    expect(
      resolveUserDataDirName({ isEnterprise: true, isPackaged: false, sharedDevData: false }),
    ).toBe(`${ENTERPRISE_APP_DATA_DIR_NAME}${DEV_APP_DATA_DIR_SUFFIX}`);
  });
});
