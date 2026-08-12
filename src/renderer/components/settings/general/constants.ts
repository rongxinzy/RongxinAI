import type { LanguageType } from '../../../services/i18n';

export const GeneralLanguageOption = {
  Chinese: 'zh',
  English: 'en',
} as const satisfies Record<string, LanguageType>;
