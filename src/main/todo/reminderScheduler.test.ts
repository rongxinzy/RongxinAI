import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  Notification: {
    isSupported: () => true,
  },
}));

import { TodoReminderScheduler } from './reminderScheduler';
import { TodoRepository } from './repository';
import { initializeTodoSchema } from './schema';

afterEach(() => {
  vi.useRealTimers();
});

test('marks a reminder only after the notification is shown', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0, 0));
  const db = new Database(':memory:');
  initializeTodoSchema(db);
  const repository = new TodoRepository(db);
  const todo = repository.create({ title: 'Review the release', remindAt: Date.now() });
  const show = vi.fn();
  const scheduler = new TodoReminderScheduler(db, { isSupported: () => true, show });

  try {
    scheduler.start();
    vi.advanceTimersByTime(0);

    expect(show).toHaveBeenCalledOnce();
    const row = db.prepare('SELECT remind_notified_at FROM todos WHERE id = ?').get(todo.id) as {
      remind_notified_at: number | null;
    };
    expect(row.remind_notified_at).toBe(Date.now());
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('keeps failed reminders pending and retries them later', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0, 0));
  const db = new Database(':memory:');
  initializeTodoSchema(db);
  const repository = new TodoRepository(db);
  const todo = repository.create({ title: 'Review the release', remindAt: Date.now() });
  const show = vi.fn().mockImplementationOnce(() => {
    throw new Error('Notification service unavailable');
  });
  const scheduler = new TodoReminderScheduler(db, { isSupported: () => true, show });

  try {
    scheduler.start();
    vi.advanceTimersByTime(0);

    const failedRow = db
      .prepare('SELECT remind_notified_at FROM todos WHERE id = ?')
      .get(todo.id) as { remind_notified_at: number | null };
    expect(failedRow.remind_notified_at).toBeNull();

    vi.advanceTimersByTime(60_000);

    expect(show).toHaveBeenCalledTimes(2);
    const deliveredRow = db
      .prepare('SELECT remind_notified_at FROM todos WHERE id = ?')
      .get(todo.id) as { remind_notified_at: number | null };
    expect(deliveredRow.remind_notified_at).toBe(Date.now());
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('does not acknowledge reminders when notifications are unsupported', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0, 0));
  const db = new Database(':memory:');
  initializeTodoSchema(db);
  const repository = new TodoRepository(db);
  const todo = repository.create({ title: 'Review the release', remindAt: Date.now() });
  const show = vi.fn();
  const scheduler = new TodoReminderScheduler(db, { isSupported: () => false, show });

  try {
    scheduler.start();
    vi.advanceTimersByTime(0);

    expect(show).not.toHaveBeenCalled();
    const row = db.prepare('SELECT remind_notified_at FROM todos WHERE id = ?').get(todo.id) as {
      remind_notified_at: number | null;
    };
    expect(row.remind_notified_at).toBeNull();
  } finally {
    scheduler.stop();
    db.close();
  }
});
