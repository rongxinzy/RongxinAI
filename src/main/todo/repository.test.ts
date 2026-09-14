import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { TodoStatus, TodoView } from '../../shared/todo';
import { TodoRepository } from './repository';
import { initializeTodoSchema } from './schema';

const createRepository = () => {
  const db = new Database(':memory:');
  initializeTodoSchema(db);
  return { db, repository: new TodoRepository(db) };
};

test('creates todos and filters the core views', () => {
  const { db, repository } = createRepository();
  try {
    const important = repository.create({
      title: 'Prepare the A64 plan',
      important: true,
      dueAt: new Date(2026, 8, 5, 23, 59).getTime(),
      myDayDate: '2026-09-03',
    });
    const ordinary = repository.create({ title: 'Read the notes' });
    repository.update(ordinary.id, { status: TodoStatus.Completed });

    expect(repository.list({ view: TodoView.MyDay, referenceDate: '2026-09-03' })).toHaveLength(1);
    expect(repository.list({ view: TodoView.Important }).map(todo => todo.id)).toEqual([
      important.id,
    ]);
    expect(repository.list({ view: TodoView.Completed }).map(todo => todo.id)).toEqual([
      ordinary.id,
    ]);
  } finally {
    db.close();
  }
});

test('defaults the My Day reference date to the local calendar day', () => {
  const { db, repository } = createRepository();
  try {
    const today = new Date();
    const localDateKey =
      `${today.getFullYear()}-` +
      `${String(today.getMonth() + 1).padStart(2, '0')}-` +
      `${String(today.getDate()).padStart(2, '0')}`;
    repository.create({ title: 'Plan the sprint', myDayDate: localDateKey });

    expect(repository.list({ view: TodoView.MyDay })).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('re-arms a reminder when its time changes and keeps it delivered otherwise', () => {
  const { db, repository } = createRepository();
  try {
    const reminderAt = new Date(2026, 8, 14, 10, 0).getTime();
    const todo = repository.create({ title: 'Call the vendor', remindAt: reminderAt });
    const readNotifiedAt = (): number | null =>
      (
        db.prepare('SELECT remind_notified_at FROM todos WHERE id = ?').get(todo.id) as {
          remind_notified_at: number | null;
        }
      ).remind_notified_at;

    // Simulate the scheduler having delivered this reminder already.
    const deliveredAt = reminderAt + 40;
    db.prepare('UPDATE todos SET remind_notified_at = ? WHERE id = ?').run(deliveredAt, todo.id);

    // Re-saving the same time must not re-arm an already delivered reminder.
    repository.update(todo.id, { remindAt: reminderAt });
    expect(readNotifiedAt()).toBe(deliveredAt);

    // Moving the reminder before the delivered moment must clear the delivered
    // state, otherwise the scheduler skips the new time forever.
    repository.update(todo.id, { remindAt: reminderAt - 60_000 });
    expect(readNotifiedAt()).toBeNull();
  } finally {
    db.close();
  }
});

test('persists notes, lists, and ordered checklist steps', () => {
  const { db, repository } = createRepository();
  try {
    const list = repository.createList('Work');
    const todo = repository.create({ title: 'Investigate the GPU issue', listId: list.id });
    const first = repository.createStep({ todoId: todo.id, title: 'Collect logs' });
    const second = repository.createStep({ todoId: todo.id, title: 'Check PCIe errors' });
    repository.update(todo.id, { note: 'Keep the incident context here.' });
    repository.updateStep({ id: first.id, completed: true });

    const saved = repository.get(todo.id);
    expect(saved?.note).toBe('Keep the incident context here.');
    expect(saved?.listName).toBe('Work');
    expect(saved?.steps.map(step => step.title)).toEqual(['Collect logs', 'Check PCIe errors']);
    expect(saved?.steps[0]?.completed).toBe(true);

    repository.deleteStep(second.id);
    repository.deleteList(list.id);
    expect(repository.get(todo.id)?.listId).toBeNull();
  } finally {
    db.close();
  }
});

test('rejects duplicate list names without changing existing data', () => {
  const { db, repository } = createRepository();
  try {
    repository.createList('Personal');
    expect(() => repository.createList('personal')).toThrow();
    expect(repository.listLists().map(list => list.name)).toEqual(['Personal']);
  } finally {
    db.close();
  }
});
