import { describe, expect, test } from 'vitest';

import {
  filterManagedModelSettingsTabs,
  resolveManagedModelSettingsTab,
  shouldShowLocalInferenceNavigation,
} from './managedModelUiPolicy';

describe('managed model UI policy', () => {
  test('replaces the editable model tab with the enterprise models page', () => {
    expect(
      filterManagedModelSettingsTabs(
        [{ key: 'general' }, { key: 'model' }, { key: 'extension:models' }],
        true,
      ),
    ).toEqual([{ key: 'general' }, { key: 'extension:models' }]);
    expect(resolveManagedModelSettingsTab('model', true, 'extension:models')).toBe(
      'extension:models',
    );
  });

  test('hides local inference navigation only for exclusive managed models', () => {
    expect(shouldShowLocalInferenceNavigation(false, true)).toBe(false);
    expect(shouldShowLocalInferenceNavigation(false, false)).toBe(true);
    expect(shouldShowLocalInferenceNavigation(true, false)).toBe(false);
  });
});
