import { expect, test } from 'vitest';

import { PiUnattendedSystemPrompt, shouldExposeAskUserQuestionTool } from './piUnattendedPolicy';

test('defines an autonomous policy for unattended runs', () => {
  expect(PiUnattendedSystemPrompt).toContain('No user interaction is available');
  expect(PiUnattendedSystemPrompt).toContain('Make reasonable assumptions');
  expect(PiUnattendedSystemPrompt).toContain('safest viable next action');
  expect(PiUnattendedSystemPrompt).toContain('external credentials or authorization');
});

test('exposes AskUserQuestion only for attended runs', () => {
  expect(shouldExposeAskUserQuestionTool(false)).toBe(true);
  expect(shouldExposeAskUserQuestionTool(true)).toBe(false);
});
