import { caseDetailTranslations } from '../caseDetailTranslations';
import { magpieTranslations } from '../magpieTranslations';
import { modelBrowseTranslations } from '../modelBrowseTranslations';

import { enTranslations } from './en';
import { zhTranslations } from './zh';
import type { LanguageType } from './types';

// 语言文本映射
export const translations: Record<LanguageType, Record<string, string>> = {
  zh: {
    ...caseDetailTranslations.zh,
    ...magpieTranslations.zh,
    ...modelBrowseTranslations.zh,
    ...zhTranslations,
  },
  en: {
    ...caseDetailTranslations.en,
    ...magpieTranslations.en,
    ...modelBrowseTranslations.en,
    ...enTranslations,
  },
};
