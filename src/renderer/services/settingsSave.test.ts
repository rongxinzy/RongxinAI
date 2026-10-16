import { expect, test } from 'vitest';

import { defaultConfig } from '../config';
import { buildAppSettingsSavePatch, getSettingsSaveErrorMessage } from './settingsSave';

const translate = (key: string): string =>
  ({
    failedToSaveSettings: 'save failed',
    settingsPartiallySaved: 'partially saved: {0}',
  })[key] ?? key;

test('preserves the original error before app config is committed', () => {
  expect(getSettingsSaveErrorMessage(new Error('storage failed'), false, translate)).toBe(
    'storage failed',
  );
});

test('reports a partial save after app config is committed', () => {
  expect(getSettingsSaveErrorMessage(new Error('gateway failed'), true, translate)).toBe(
    'partially saved: gateway failed',
  );
});

test('uses the translated fallback for non-error failures', () => {
  expect(getSettingsSaveErrorMessage('unknown', true, translate)).toBe(
    'partially saved: save failed',
  );
});

test('saves only appearance changes without rewriting model configuration', () => {
  const patch = buildAppSettingsSavePatch({
    current: defaultConfig,
    theme: 'dark',
    language: defaultConfig.language,
    useSystemProxy: defaultConfig.useSystemProxy,
    sqliteAutoBackupEnabled: defaultConfig.sqliteAutoBackupEnabled ?? false,
    shortcuts: defaultConfig.shortcuts!,
  });

  expect(patch).toEqual({ theme: 'dark' });
});

test('saving appearance does not overwrite a stored legacy style identifier', () => {
  const current = { ...defaultConfig, themeStyle: 'legacy-custom-style' };
  const patch = buildAppSettingsSavePatch({
    current,
    theme: 'dark',
    language: current.language,
    useSystemProxy: current.useSystemProxy,
    sqliteAutoBackupEnabled: current.sqliteAutoBackupEnabled ?? false,
    shortcuts: current.shortcuts!,
  });
  expect(patch).toEqual({ theme: 'dark' });
  expect({ ...current, ...patch }.themeStyle).toBe('legacy-custom-style');
});
