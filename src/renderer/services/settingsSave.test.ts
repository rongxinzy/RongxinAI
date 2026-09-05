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
    providers: defaultConfig.providers,
    api: defaultConfig.api,
    model: defaultConfig.model,
  });

  expect(patch).toEqual({ theme: 'dark' });
});

test('includes API and model configuration only when providers changed', () => {
  const providers = {
    ...defaultConfig.providers,
    deepseek: {
      ...defaultConfig.providers!.deepseek,
      apiKey: 'test-key',
    },
  };
  const patch = buildAppSettingsSavePatch({
    current: defaultConfig,
    theme: defaultConfig.theme,
    language: defaultConfig.language,
    useSystemProxy: defaultConfig.useSystemProxy,
    sqliteAutoBackupEnabled: defaultConfig.sqliteAutoBackupEnabled ?? false,
    shortcuts: defaultConfig.shortcuts!,
    providers,
    api: { key: 'test-key', baseUrl: defaultConfig.api.baseUrl },
    model: defaultConfig.model,
  });

  expect(patch).toMatchObject({ providers, api: { key: 'test-key' }, model: defaultConfig.model });
});

test('saves a style change independently from appearance and model settings', () => {
  const input = {
    current: defaultConfig,
    theme: defaultConfig.theme,
    themeStyle: 'paper',
    language: defaultConfig.language,
    useSystemProxy: defaultConfig.useSystemProxy,
    sqliteAutoBackupEnabled: defaultConfig.sqliteAutoBackupEnabled ?? false,
    shortcuts: defaultConfig.shortcuts!,
    providers: defaultConfig.providers,
    api: defaultConfig.api,
    model: defaultConfig.model,
  };
  expect(buildAppSettingsSavePatch(input)).toEqual({ themeStyle: 'paper' });
  expect(buildAppSettingsSavePatch({ ...input, themeStyle: 'codex' })).toEqual({});
});
