import { Notification } from 'electron';
import type Database from 'better-sqlite3';

import { TodoStatus } from '../../shared/todo';
import { t } from '../i18n';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

type TodoReminderRow = {
  id: string;
  title: string;
  remind_at: number;
};

export class TodoReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isStarted = false;

  constructor(private readonly db: Database.Database) {}

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.refresh();
  }

  stop(): void {
    this.isStarted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  refresh(): void {
    if (!this.isStarted) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const nextReminder = this.db
      .prepare(
        'SELECT id, title, remind_at ' +
          'FROM todos ' +
          'WHERE status = ? ' +
          'AND remind_at IS NOT NULL ' +
          'AND (remind_notified_at IS NULL OR remind_notified_at < remind_at) ' +
          'ORDER BY remind_at ASC ' +
          'LIMIT 1',
      )
      .get(TodoStatus.Active) as TodoReminderRow | undefined;
    if (!nextReminder) return;

    const delay = Math.min(Math.max(nextReminder.remind_at - Date.now(), 0), MAX_TIMER_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deliverDueReminders();
    }, delay);
  }

  private deliverDueReminders(): void {
    const reminders = this.db
      .prepare(
        'SELECT id, title, remind_at ' +
          'FROM todos ' +
          'WHERE status = ? ' +
          'AND remind_at IS NOT NULL ' +
          'AND remind_at <= ? ' +
          'AND (remind_notified_at IS NULL OR remind_notified_at < remind_at) ' +
          'ORDER BY remind_at ASC',
      )
      .all(TodoStatus.Active, Date.now()) as TodoReminderRow[];

    for (const reminder of reminders) {
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: t('todoReminderTitle'),
            body: t('todoReminderBody', { title: reminder.title }),
          }).show();
        } catch (error) {
          console.error('[TodoReminder] failed to show reminder:', error);
        }
      }

      this.db
        .prepare(
          'UPDATE todos ' +
            'SET remind_notified_at = ? ' +
            'WHERE id = ? AND status = ? AND remind_at = ? ' +
            'AND (remind_notified_at IS NULL OR remind_notified_at < remind_at)',
        )
        .run(Date.now(), reminder.id, TodoStatus.Active, reminder.remind_at);
    }

    this.refresh();
  }
}
