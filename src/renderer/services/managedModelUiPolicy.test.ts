import { describe, expect, test } from 'vitest';

import {
  filterManagedModelSettingsTabs,
  resolveManagedModelSettingsTab,
  shouldShowLocalInferenceNavigation,
} from './managedModelUiPolicy';

describe('managed model UI policy', () => {
  test('hides only the model settings tab when managed models are exclusive', () => {
    const tabs = [{ key: 'general' }, { key: 'model' }, { key: 'about' }];

    expect(filterManagedModelSettingsTabs(tabs, true)).toEqual([
      { key: 'general' },
      { key: 'about' },
    ]);
    expect(filterManagedModelSettingsTabs(tabs, false)).toEqual(tabs);
  });

  test('moves a hidden active tab to enterprise settings when available', () => {
    expect(resolveManagedModelSettingsTab('model', true, true)).toBe('extension');
    expect(resolveManagedModelSettingsTab('model', true, false)).toBe('general');
    expect(resolveManagedModelSettingsTab('model', false, true)).toBe('model');
  });

  test('hides local inference in chat mode and managed model mode', () => {
    expect(shouldShowLocalInferenceNavigation(false, false)).toBe(true);
    expect(shouldShowLocalInferenceNavigation(true, false)).toBe(false);
    expect(shouldShowLocalInferenceNavigation(false, true)).toBe(false);
  });
});
