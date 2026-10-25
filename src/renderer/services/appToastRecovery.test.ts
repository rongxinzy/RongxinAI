// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkErrorKind, getUserErrorI18nKey } from '../../common/coworkError';
import { showAppError } from './appToast';
import { i18nService } from './i18n';
import { resetAppToastDedupeForTests } from './toastNotification';

afterEach(() => i18nService.setLanguage('zh', { persist: false }));

test.each(['zh', 'en'] as const)('all classified operation failures have %s copy', language => {
  i18nService.setLanguage(language, { persist: false });
  for (const kind of Object.values(CoworkErrorKind)) {
    const key = getUserErrorI18nKey(kind);
    expect(i18nService.t(key), key).not.toBe(key);
  }
});

test('retryable failures retain error presentation and warning diagnostics', () => {
  const fromRenderer = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(window, 'electron');
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { log: { fromRenderer } },
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const received: Array<{ message: string; isError: boolean }> = [];
  const listener = (event: Event) => received.push((event as CustomEvent).detail);
  window.addEventListener('app:showToast', listener);
  i18nService.setLanguage('zh', { persist: false });
  resetAppToastDedupeForTests();
  try {
    const text = showAppError(new Error('request timed out'), undefined, 'ModelSettings', 'warn');
    expect(warn).toHaveBeenCalledExactlyOnceWith('[ModelSettings] request timed out');
    expect(error).not.toHaveBeenCalled();
    expect(fromRenderer).toHaveBeenCalledExactlyOnceWith(
      'warn',
      'ModelSettings',
      'request timed out',
    );
    expect(received).toEqual([{ message: text, isError: true }]);
    expect(text).toMatch(/超时/);
  } finally {
    window.removeEventListener('app:showToast', listener);
    warn.mockRestore();
    error.mockRestore();
    if (previous) Object.defineProperty(window, 'electron', previous);
    else Reflect.deleteProperty(window, 'electron');
    resetAppToastDedupeForTests();
  }
});
