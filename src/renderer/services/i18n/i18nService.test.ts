import { afterEach, describe, expect, test, vi } from 'vitest';

import { i18nService } from './i18nService';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

describe('i18nService', () => {
  test('translates keys in the current language', () => {
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('save')).toBe('保存');

    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('save')).toBe('Save');
  });

  test('returns the key itself when it is missing in both languages', () => {
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('__missing_key_for_test__')).toBe('__missing_key_for_test__');
  });

  test('exposes the current language via getLanguage', () => {
    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.getLanguage()).toBe('en');
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.getLanguage()).toBe('zh');
  });

  test('notifies subscribers only when the language changes', () => {
    const listener = vi.fn();
    const unsubscribe = i18nService.subscribe(listener);

    i18nService.setLanguage('zh', { persist: false });
    expect(listener).not.toHaveBeenCalled();

    i18nService.setLanguage('en', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    i18nService.setLanguage('zh', { persist: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
