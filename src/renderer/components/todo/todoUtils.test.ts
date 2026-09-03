import { expect, test } from 'vitest';

import { fromDateInputValue, parseTodoInput, toDateInputValue } from './todoUtils';

const now = new Date(2026, 8, 3, 10, 30, 0, 0);

test('parses Chinese natural-language dates and importance', () => {
  const parsed = parseTodoInput('明天提交重要报告', now);

  expect(parsed.dueAt).toBe(new Date(2026, 8, 4, 23, 59, 59, 999).getTime());
  expect(parsed.important).toBe(true);
});

test('checks day-after-tomorrow before the shorter English token', () => {
  const parsed = parseTodoInput('finish this day after tomorrow', now);

  expect(parsed.dueAt).toBe(new Date(2026, 8, 5, 23, 59, 59, 999).getTime());
});

test('rejects invalid calendar dates instead of rolling them forward', () => {
  expect(fromDateInputValue('2026-02-31')).toBeNull();
});

test('formats date inputs in the local timezone', () => {
  const timestamp = new Date(2026, 8, 3, 12, 0, 0, 0).getTime();

  expect(toDateInputValue(timestamp)).toBe('2026-09-03');
});
