import { magpieProviderTranslations } from './magpieProviderTranslations';
import { magpieTranslationsZh } from './magpieTranslations.zh';
import { magpieTranslationsEn } from './magpieTranslations.en';

export const magpieTranslations = {
  zh: { ...magpieTranslationsZh, ...magpieProviderTranslations.zh },
  en: { ...magpieTranslationsEn, ...magpieProviderTranslations.en },
};
