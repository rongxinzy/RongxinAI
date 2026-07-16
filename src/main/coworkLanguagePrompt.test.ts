import { describe, expect, test } from 'vitest';

import { applyCoworkLanguagePrompt } from './coworkLanguagePrompt';

describe('applyCoworkLanguagePrompt', () => {
  test('adds an explicit English instruction', () => {
    const prompt = applyCoworkLanguagePrompt('base prompt', 'en');

    expect(prompt).toContain(
      'The current application language is English. Respond in English by default.',
    );
    expect(prompt).toContain('base prompt');
  });

  test('replaces a previous language instruction instead of duplicating it', () => {
    const englishPrompt = applyCoworkLanguagePrompt('base prompt', 'en');
    const chinesePrompt = applyCoworkLanguagePrompt(englishPrompt, 'zh');

    expect(chinesePrompt).toContain('当前应用语言为中文。默认使用中文回复。');
    expect(chinesePrompt).not.toContain('The current application language is English.');
    expect(chinesePrompt.match(/<cowork-response-language>/g)).toHaveLength(1);
  });
});
