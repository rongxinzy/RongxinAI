import { expect, test } from 'vitest';

import {
  getRevealCharacterCount,
  isPlainTextStreamingTail,
  shouldResetTextReveal,
} from './adaptiveTextReveal';

test('animates only plain-text streaming tails', () => {
  expect(isPlainTextStreamingTail('正在整理结果')).toBe(true);
  expect(isPlainTextStreamingTail('`const answer = 42`')).toBe(false);
  expect(isPlainTextStreamingTail('- task item')).toBe(false);
});

test('accelerates for backlog and synchronizes exceptionally large backlogs', () => {
  expect(getRevealCharacterCount(24, 16)).toBeGreaterThanOrEqual(1);
  expect(getRevealCharacterCount(900, 16)).toBeGreaterThan(getRevealCharacterCount(24, 16));
  expect(getRevealCharacterCount(2_000, 16)).toBe(2_000);
});

test('resets the reveal when a committed segment replaces the streaming tail', () => {
  expect(shouldResetTextReveal('First paragraph\n\nSecond paragraph', 'Second paragraph')).toBe(true);
  expect(shouldResetTextReveal('Second paragraph', 'Second paragraph continues')).toBe(false);
});
