/**
 * Lightweight i18n module for the Electron main process.
 *
 * Mirrors the renderer's i18nService pattern but runs in Node (no DOM/window).
 * Keeps only the small subset of keys needed by main-process code
 * (tray menu, session titles, etc.).
 *
 * Usage:
 *   import { t, setLanguage } from './i18n';
 *   setLanguage('en');
 *   const label = t('trayShowWindow'); // "Open 知远"
 *   const msg = t('imMissingCredentials', { fields: 'appId, appSecret' });
 */

import { zhMain1 } from './i18n/zh-1';
import { zhMain2 } from './i18n/zh-2';
import { zhMain3 } from './i18n/zh-3';
import { enMain1 } from './i18n/en-1';
import { enMain2 } from './i18n/en-2';
import { enMain3 } from './i18n/en-3';
import { companionMessages } from '../shared/companion/messages';

export type LanguageType = 'zh' | 'en';

const translations: Record<LanguageType, Record<string, string>> = {
  zh: { ...zhMain1, ...zhMain2, ...zhMain3, ...companionMessages.zh },
  en: { ...enMain1, ...enMain2, ...enMain3, ...companionMessages.en },
};

let currentLanguage: LanguageType = 'zh';

/** Set the active language. Call this when app_config.language changes. */
export function setLanguage(language: LanguageType): void {
  currentLanguage = language;
}

/**
 * Look up a translation key and optionally interpolate `{param}` placeholders.
 * Returns the key itself if no translation exists.
 *
 *   t('imMissingCredentials', { fields: 'appId, appSecret' })
 *   // => "缺少必要配置项: appId, appSecret"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text =
    translations[currentLanguage][key] ??
    translations[currentLanguage === 'zh' ? 'en' : 'zh'][key] ??
    key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
