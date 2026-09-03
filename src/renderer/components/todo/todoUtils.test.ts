import { expect, test } from 'vitest';

import { TodoView, type Todo } from '../../../shared/todo';
import {
  buildTodoCreateInput,
  countTodosByView,
  fromDateInputValue,
  parseTodoInput,
  toDateInputValue,
} from './todoUtils';

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

test('keeps calendar dates correct across daylight saving transitions', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const daylightSavingEnd = new Date(2026, 10, 1, 0, 30, 0, 0);

    expect(parseTodoInput('tomorrow', daylightSavingEnd).dueAt).toBe(
      new Date(2026, 10, 2, 23, 59, 59, 999).getTime(),
    );
    expect(parseTodoInput('mon', daylightSavingEnd).dueAt).toBe(
      new Date(2026, 10, 2, 23, 59, 59, 999).getTime(),
    );
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('creates tasks in the active custom list', () => {
  expect(
    buildTodoCreateInput(
      'Review the release',
      { dueAt: null, important: false },
      TodoView.All,
      'release-list',
      '2026-09-03',
    ),
  ).toMatchObject({
    title: 'Review the release',
    listId: 'release-list',
    myDayDate: null,
  });
});

test('includes completed tasks in contextual counts', () => {
  const activeTodo = {
    id: 'active',
    title: 'Active task',
    note: '',
    status: 'active',
    important: false,
    dueAt: null,
    remindAt: null,
    listId: null,
    listName: null,
    myDayDate: null,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    sourceType: 'manual',
    sourceId: null,
    steps: [],
  } satisfies Todo;

  expect(countTodosByView([activeTodo], 3, '2026-09-03')[TodoView.Completed]).toBe(3);
});
