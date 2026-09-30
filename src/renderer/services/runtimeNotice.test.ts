// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CoworkErrorKind } from '../../common/coworkError';
import { i18nService } from './i18n';
import { startRuntimeNoticeListener } from './runtimeNotice';

const captureToasts = () => {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string } | string>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  };
  window.addEventListener('app:showToast', listener);
  return { seen, stop: () => window.removeEventListener('app:showToast', listener) };
};

beforeEach(() => i18nService.setLanguage('zh', { persist: false }));
afterEach(() => i18nService.setLanguage('zh', { persist: false }));

describe('runtime retry notice', () => {
  test('prompts the user with the classified reason while the model is retried', () => {
    const toasts = captureToasts();
    let emit: ((notice: unknown) => void) | null = null;
    const previous = window.electron;
    window.electron = {
      ...previous,
      runtimeNotices: {
        onNotice: (callback: (notice: never) => void) => {
          emit = callback as unknown as (notice: unknown) => void;
          return () => undefined;
        },
      },
    } as typeof window.electron;

    try {
      startRuntimeNoticeListener();
      expect(emit).not.toBeNull();
      emit!({
        sessionId: 'session-1',
        kind: CoworkErrorKind.AuthExpired,
        message: '502: invalid api key',
        attempt: 1,
      });

      expect(toasts.seen).toEqual([
        i18nService
          .t('runtimeRetryNotice')
          .replace('{reason}', i18nService.t('coworkErrorAuthInvalid')),
      ]);
      expect(toasts.seen[0]).toContain('API 密钥');
    } finally {
      toasts.stop();
      window.electron = previous;
    }
  });
});
