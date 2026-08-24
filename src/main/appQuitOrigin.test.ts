import { beforeEach, describe, expect, test } from 'vitest';

import {
  AppQuitOrigin,
  getAppQuitOrigin,
  recordAppQuitOrigin,
  resetAppQuitOriginForTesting,
} from './appQuitOrigin';

describe('app quit origin', () => {
  beforeEach(() => resetAppQuitOriginForTesting());

  test('uses the Electron before-quit fallback when no source was recorded', () => {
    expect(getAppQuitOrigin()).toBe(AppQuitOrigin.ElectronBeforeQuit);
  });

  test('keeps the first recorded source', () => {
    recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
    recordAppQuitOrigin(AppQuitOrigin.WindowAllClosed);

    expect(getAppQuitOrigin()).toBe(AppQuitOrigin.UpdateInstall);
  });
});
