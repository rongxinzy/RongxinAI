import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildScheduledTaskEnginePrompt } from '../../scheduledTask/enginePrompt';
import { applyCoworkLanguagePrompt } from '../coworkLanguagePrompt';
import { composeCoworkSystemPrompt } from './composer';
import { CoworkBundledPromptMarker, ZhiyuanIdentityPrompt } from './constants';

const countOccurrences = (value: string, target: string): number => value.split(target).length - 1;

const expert = (promptSnapshot: string) => ({
  promptSnapshot,
});

test('preserves the bundled identity once across composition and expert switching', () => {
  const basePrompt = readFileSync('resources/SYSTEM_PROMPT.md', 'utf8');
  let prompt = basePrompt;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    prompt = composeCoworkSystemPrompt({ basePrompt: prompt, language: 'zh' });
  }
  expect(countOccurrences(prompt, CoworkBundledPromptMarker.IdentityStart)).toBe(1);
  expect(prompt).not.toContain(ZhiyuanIdentityPrompt);
  expect(prompt).toContain('北京容芯致远科技有限公司');

  const selectedExpert = expert('Follow expert A SOP.');
  const withExpert = composeCoworkSystemPrompt({
    basePrompt: prompt,
    expertSnapshots: [selectedExpert],
    language: 'zh',
  });
  expect(withExpert.indexOf(selectedExpert.promptSnapshot)).toBeLessThan(
    withExpert.indexOf(CoworkBundledPromptMarker.IdentityStart),
  );
  const restored = composeCoworkSystemPrompt({
    basePrompt: withExpert,
    previousExpertSnapshots: [selectedExpert],
    language: 'zh',
  });
  expect(restored).toBe(prompt);
});

test('retains fallback identity when the bundled block is incomplete or empty', () => {
  for (const basePrompt of [
    '',
    CoworkBundledPromptMarker.IdentityStart,
    `${CoworkBundledPromptMarker.IdentityStart}\n ${CoworkBundledPromptMarker.IdentityEnd}`,
    `${CoworkBundledPromptMarker.IdentityEnd} text ${CoworkBundledPromptMarker.IdentityStart}`,
  ]) {
    const prompt = composeCoworkSystemPrompt({ basePrompt, language: 'en' });
    expect(countOccurrences(prompt, ZhiyuanIdentityPrompt)).toBe(1);
  }
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

test('places the expert block before the base prompt with identity precedence', () => {
  const selectedExpert = expert('Follow expert A SOP.');
  const composed = composeCoworkSystemPrompt({
    basePrompt: 'Base prompt',
    expertSnapshots: [selectedExpert],
    language: 'zh',
  });

  const expertStart = composed.indexOf('<cowork-managed-experts>');
  const baseStart = composed.indexOf('Base prompt');
  expect(expertStart).toBeGreaterThan(-1);
  expect(baseStart).toBeGreaterThan(expertStart);
  expect(composed).toContain('以下专家身份优先于任何默认身份设定');
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
