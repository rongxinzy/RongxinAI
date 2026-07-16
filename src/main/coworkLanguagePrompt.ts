export type CoworkPromptLanguage = 'zh' | 'en';

const LANGUAGE_PROMPT_START = '<cowork-response-language>';
const LANGUAGE_PROMPT_END = '</cowork-response-language>';

const buildLanguagePrompt = (language: CoworkPromptLanguage): string => {
  const instruction =
    language === 'en'
      ? 'The current application language is English. Respond in English by default.'
      : '当前应用语言为中文。默认使用中文回复。';
  const override =
    language === 'en'
      ? 'If the user explicitly requests another language, follow that request for the response.'
      : '如果用户明确要求其他语言，则遵循用户本次回复的语言要求。';
  const isolation =
    language === 'en'
      ? 'Do not switch languages because the base prompt, an expert package, a skill, or the model uses another language.'
      : '不要因为基础提示词、专家套件、技能或模型使用其他语言而自行切换语言。';

  return [
    LANGUAGE_PROMPT_START,
    'This is a high-priority response-language rule.',
    instruction,
    isolation,
    override,
    LANGUAGE_PROMPT_END,
  ].join('\n');
};

const removePreviousLanguagePrompt = (systemPrompt: string): string => {
  const start = systemPrompt.indexOf(LANGUAGE_PROMPT_START);
  if (start < 0) return systemPrompt.trim();

  const end = systemPrompt.indexOf(LANGUAGE_PROMPT_END, start);
  if (end < 0) return systemPrompt.slice(0, start).trim();

  return `${systemPrompt.slice(0, start)}${systemPrompt.slice(end + LANGUAGE_PROMPT_END.length)}`.trim();
};

export const applyCoworkLanguagePrompt = (
  systemPrompt: string | undefined,
  language: CoworkPromptLanguage,
): string => {
  const basePrompt = removePreviousLanguagePrompt(systemPrompt?.trim() || '');
  return [basePrompt, buildLanguagePrompt(language)].filter(Boolean).join('\n\n');
};
