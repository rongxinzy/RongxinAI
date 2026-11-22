import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  show: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) =>
      ipc.handlers.set(channel, handler),
  },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => true;
    show = ipc.show;
  },
}));

import { TodoIpc } from '../../shared/todo';
import { registerTodoIpcHandlers, stopTodoReminders } from './ipc';
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

    vi.advanceTimersByTime(120_000);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('a todo created through IPC rearms the owned timer, and stopping prevents later writes', async () => {
  vi.useFakeTimers();
  const db = new Database(':memory:');
  initializeTodoSchema(db);
  try {
    registerTodoIpcHandlers(db);
    const create = ipc.handlers.get(TodoIpc.Create)!;
    await expect(
      create({}, { title: 'First reminder', remindAt: Date.now() + 100 }),
    ).resolves.toMatchObject({ success: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(ipc.show).toHaveBeenCalledOnce();

    await expect(
      create({}, { title: 'Second reminder', remindAt: Date.now() + 100 }),
    ).resolves.toMatchObject({ success: true });
    stopTodoReminders();
    db.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(ipc.show).toHaveBeenCalledOnce();
  } finally {
    stopTodoReminders();
    if (db.open) db.close();
    ipc.handlers.clear();
    ipc.show.mockClear();
  }
});
