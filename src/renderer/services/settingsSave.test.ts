import { expect, test } from 'vitest';

import { getSettingsSaveErrorMessage } from './settingsSave';

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
