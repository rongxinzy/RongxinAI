import { expect, test } from 'vitest';
import { buildCoworkSystemPrompt } from './coworkSystemPrompt';

test('joins the skill and base prompts with a blank line', () => {
  expect(buildCoworkSystemPrompt('skill prompt', 'base prompt')).toBe(
    'skill prompt\n\nbase prompt',
  );
});

test('keeps either prompt when the other is absent', () => {
  expect(buildCoworkSystemPrompt('skill prompt', undefined)).toBe('skill prompt');
  expect(buildCoworkSystemPrompt(undefined, 'base prompt')).toBe('base prompt');
});

test('omits missing and whitespace-only prompts', () => {
  expect(buildCoworkSystemPrompt(undefined, undefined)).toBeUndefined();
  expect(buildCoworkSystemPrompt('   ', 'base prompt')).toBe('base prompt');
  expect(buildCoworkSystemPrompt('   ', '')).toBeUndefined();
});
