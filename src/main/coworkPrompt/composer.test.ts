import { expect, test } from 'vitest';

import { buildScheduledTaskEnginePrompt } from '../../scheduledTask/enginePrompt';
import { applyCoworkLanguagePrompt } from '../coworkLanguagePrompt';
import { composeCoworkSystemPrompt } from './composer';
import { ZhiyuanIdentityPrompt } from './constants';

const countOccurrences = (value: string, target: string): number => value.split(target).length - 1;

const expert = (promptSnapshot: string) => ({
  promptSnapshot,
});

test('keeps managed prompt sections idempotent across repeated composition', () => {
  let prompt = 'User-configured instructions.';
  for (let iteration = 0; iteration < 10; iteration += 1) {
    prompt = composeCoworkSystemPrompt({ basePrompt: prompt, language: 'zh' });
  }

  expect(countOccurrences(prompt, ZhiyuanIdentityPrompt)).toBe(1);
  expect(countOccurrences(prompt, buildScheduledTaskEnginePrompt())).toBe(1);
  expect(countOccurrences(prompt, '<cowork-response-language>')).toBe(1);
  expect(countOccurrences(prompt, 'User-configured instructions.')).toBe(1);
});

test('normalizes repeated legacy scheduled-task and language blocks', () => {
  const scheduledPrompt = buildScheduledTaskEnginePrompt();
  const legacyPrompt = applyCoworkLanguagePrompt(
    ['Base prompt', ...Array.from({ length: 10 }, () => scheduledPrompt)].join('\n\n'),
    'zh',
  );
  const composed = composeCoworkSystemPrompt({ basePrompt: legacyPrompt, language: 'en' });

  expect(countOccurrences(composed, scheduledPrompt)).toBe(1);
  expect(countOccurrences(composed, '<cowork-response-language>')).toBe(1);
  expect(composed).toContain('The current application language is English.');
});

test('keeps the selected expert SOP exactly once', () => {
  const selectedExpert = expert('Follow expert A SOP.');
  let prompt = composeCoworkSystemPrompt({
    basePrompt: 'Base prompt',
    expertSnapshots: [selectedExpert],
    language: 'zh',
  });
  prompt = composeCoworkSystemPrompt({
    basePrompt: prompt,
    expertSnapshots: [selectedExpert],
    previousExpertSnapshots: [selectedExpert],
    language: 'zh',
  });

  expect(countOccurrences(prompt, selectedExpert.promptSnapshot)).toBe(1);
  expect(prompt).not.toContain(ZhiyuanIdentityPrompt);
});

test('removes the previous expert SOP when the selected expert changes', () => {
  const previousExpert = expert('Follow expert A SOP.');
  const nextExpert = expert('Follow expert B SOP.');
  const previousPrompt = composeCoworkSystemPrompt({
    basePrompt: 'Base prompt',
    expertSnapshots: [previousExpert],
    language: 'zh',
  });
  const nextPrompt = composeCoworkSystemPrompt({
    basePrompt: previousPrompt,
    expertSnapshots: [nextExpert],
    previousExpertSnapshots: [previousExpert],
    language: 'zh',
  });

  expect(nextPrompt).not.toContain(previousExpert.promptSnapshot);
  expect(nextPrompt).toContain(nextExpert.promptSnapshot);
  expect(nextPrompt).not.toContain(ZhiyuanIdentityPrompt);
});
