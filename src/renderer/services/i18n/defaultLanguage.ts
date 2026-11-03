import type { LanguageType } from './types';

const PACKAGED_DEFAULT_LOCALE =
  typeof __ZHIYUAN_DEFAULT_LOCALE__ === 'string' ? __ZHIYUAN_DEFAULT_LOCALE__.trim() : '';

/** Only Simplified Chinese is treated as a Chinese first-run default. */
export function inferLanguageFromLocale(systemLocale: string): LanguageType {
  return systemLocale.trim().toLowerCase() === 'zh-cn' ? 'zh' : 'en';
}

export function getPackagedDefaultLanguage(): LanguageType | null {
  return PACKAGED_DEFAULT_LOCALE ? inferLanguageFromLocale(PACKAGED_DEFAULT_LOCALE) : null;
}

/**
 * Kylin packages compile in a zh-CN default. Other packages keep the existing
 * system-locale behavior because their packaged default is empty.
 */
export function resolveFirstRunLanguage(
  systemLocale: string,
  packagedDefaultLocale = PACKAGED_DEFAULT_LOCALE,
): LanguageType {
  return inferLanguageFromLocale(packagedDefaultLocale || systemLocale);
}
