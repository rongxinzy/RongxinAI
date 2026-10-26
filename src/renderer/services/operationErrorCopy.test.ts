import { afterEach, expect, test } from 'vitest';
import { CoworkErrorKind, getUserErrorI18nKey } from '../../common/coworkError';
import { i18nService } from './i18n';

afterEach(() => i18nService.setLanguage('zh', { persist: false }));

test.each(['zh', 'en'] as const)('classified failures have readable %s messages', language => {
  i18nService.setLanguage(language, { persist: false });
  for (const kind of Object.values(CoworkErrorKind)) {
    const key = getUserErrorI18nKey(kind);
    expect(i18nService.t(key), key).not.toBe(key);
  }
});
