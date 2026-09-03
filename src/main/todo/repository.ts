import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  TodoSourceType,
  TodoStatus,
  TodoView,
  type Todo,
  type TodoCreateInput,
  type TodoList,
  type TodoListInput,
  type TodoListUpdateInput,
  type TodoStep,
  type TodoStepCreateInput,
  type TodoStepUpdateInput,
  type TodoUpdateInput,
} from '../../shared/todo';

type TodoRow = {
  id: string;
  title: string;
  note: string;
  status: string;
  important: number;
  due_at: number | null;
  remind_at: number | null;
  list_id: string | null;
  list_name: string | null;
  my_day_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type TodoListRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

type TodoStepRow = {
  id: string;
  todo_id: string;
  title: string;
  completed: number;
  step_order: number;
  created_at: number;
  updated_at: number;
};

const toBoolean = (value: number): boolean => value === 1;

export class TodoRepository {
  constructor(private readonly db: Database.Database) {}

  list(input: TodoListInput): Todo[] {
    const conditions = ['1 = 1'];
    const params: Array<string | number> = [];
    const query = input.query?.trim().toLocaleLowerCase();

    if (input.view === TodoView.Completed) {
      conditions.push('t.status = ?');
      params.push(TodoStatus.Completed);
    } else {
      conditions.push('t.status = ?');
      params.push(TodoStatus.Active);
    }

    if (input.view === TodoView.MyDay) {
      conditions.push('t.my_day_date = ?');
      params.push(input.referenceDate ?? new Date().toISOString().slice(0, 10));
    } else if (input.view === TodoView.Important) {
      conditions.push('t.important = 1');
    } else if (input.view === TodoView.Planned) {
      conditions.push('(t.due_at IS NOT NULL OR t.remind_at IS NOT NULL)');
    }

    if (input.listId) {
      conditions.push('t.list_id = ?');
      params.push(input.listId);
    }

    if (query) {
      conditions.push('(LOWER(t.title) LIKE ? OR LOWER(t.note) LIKE ?)');
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }

    const orderBy =
      input.view === TodoView.Completed
        ? 't.completed_at DESC, t.updated_at DESC'
        : 't.due_at IS NULL, t.due_at ASC, t.created_at DESC';
    const rows = this.db
      .prepare(
        `SELECT t.*, l.name AS list_name
         FROM todos t
         LEFT JOIN todo_lists l ON l.id = t.list_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${orderBy}`,
      )
      .all(...params) as TodoRow[];

    const stepsByTodoId = this.getStepsByTodoId(rows.map(row => row.id));
    return rows.map(row => this.mapTodo(row, stepsByTodoId.get(row.id) ?? []));
  }

  get(todoId: string): Todo | null {
    const row = this.db
      .prepare(
        `SELECT t.*, l.name AS list_name
         FROM todos t
         LEFT JOIN todo_lists l ON l.id = t.list_id
         WHERE t.id = ?`,
      )
      .get(todoId) as TodoRow | undefined;
    if (!row) return null;
    return this.mapTodo(row, this.getSteps(todoId));
  }

  create(input: TodoCreateInput): Todo {
    const now = Date.now();
    const todoId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO todos
          (id, title, note, status, important, due_at, remind_at, list_id, my_day_date,
           source_type, source_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        todoId,
        input.title.trim(),
        input.note?.trim() ?? '',
        TodoStatus.Active,
        input.important ? 1 : 0,
        input.dueAt ?? null,
        input.remindAt ?? null,
        input.listId ?? null,
        input.myDayDate ?? null,
        input.sourceType ?? TodoSourceType.Manual,
        input.sourceId ?? null,
        now,
        now,
      );
    return this.require(todoId);
  }

  update(todoId: string, input: TodoUpdateInput): Todo {
    const current = this.require(todoId);
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title.trim());
    }
    if (input.note !== undefined) {
      fields.push('note = ?');
      values.push(input.note);
    }
    if (input.status !== undefined) {
      fields.push('status = ?', 'completed_at = ?');
      values.push(input.status, input.status === TodoStatus.Completed ? Date.now() : null);
    }
    if (input.important !== undefined) {
      fields.push('important = ?');
      values.push(input.important ? 1 : 0);
    }
    if (input.dueAt !== undefined) {
      fields.push('due_at = ?');
      values.push(input.dueAt);
    }
    if (input.remindAt !== undefined) {
      fields.push('remind_at = ?');
      values.push(input.remindAt);
    }
    if (input.listId !== undefined) {
      fields.push('list_id = ?');
      values.push(input.listId);
    }
    if (input.myDayDate !== undefined) {
      fields.push('my_day_date = ?');
      values.push(input.myDayDate);
    }

    if (fields.length > 0) {
      const updatedAt = Date.now();
      this.db
        .prepare(`UPDATE todos SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...values, updatedAt, todoId);
    }

    return this.require(todoId, current);
  }

  delete(todoId: string): void {
    this.require(todoId);
    this.db.prepare('DELETE FROM todos WHERE id = ?').run(todoId);
  }

  listLists(): TodoList[] {
    const rows = this.db
      .prepare('SELECT * FROM todo_lists ORDER BY name COLLATE NOCASE ASC')
      .all() as TodoListRow[];
    return rows.map(row => this.mapList(row));
  }

  createList(name: string): TodoList {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, name.trim(), now, now);
    return this.requireList(id);
  }

  updateList(listId: string, input: TodoListUpdateInput): TodoList {
    this.requireList(listId);
    this.db
      .prepare('UPDATE todo_lists SET name = ?, updated_at = ? WHERE id = ?')
      .run(input.name.trim(), Date.now(), listId);
    return this.requireList(listId);
  }

  deleteList(listId: string): void {
    this.requireList(listId);
    this.db.prepare('DELETE FROM todo_lists WHERE id = ?').run(listId);
  }

  createStep(input: TodoStepCreateInput): TodoStep {
    this.require(input.todoId);
    const now = Date.now();
    const id = randomUUID();
    const nextOrder = this.db
      .prepare(
        'SELECT COALESCE(MAX(step_order), -1) + 1 AS next_order FROM todo_steps WHERE todo_id = ?',
      )
      .get(input.todoId) as { next_order: number };
    this.db
      .prepare(
        `INSERT INTO todo_steps
          (id, todo_id, title, completed, step_order, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, input.todoId, input.title.trim(), nextOrder.next_order, now, now);
    this.touchTodo(input.todoId);
    return this.requireStep(id);
  }

  updateStep(input: TodoStepUpdateInput): TodoStep {
    const current = this.requireStep(input.id);
    const fields: string[] = [];
    const values: Array<string | number> = [];
    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title.trim());
    }
    if (input.completed !== undefined) {
      fields.push('completed = ?');
      values.push(input.completed ? 1 : 0);
    }
    if (input.order !== undefined) {
      fields.push('step_order = ?');
      values.push(input.order);
    }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(Date.now());
      this.db
        .prepare(`UPDATE todo_steps SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values, input.id);
      this.touchTodo(current.todoId);
    }
    return this.requireStep(input.id);
  }

  deleteStep(stepId: string): void {
    const step = this.requireStep(stepId);
    this.db.prepare('DELETE FROM todo_steps WHERE id = ?').run(stepId);
    this.touchTodo(step.todoId);
  }

  private require(todoId: string, fallback?: Todo): Todo {
    const todo = this.get(todoId);
    if (!todo) throw new Error('Todo not found.');
    return todo ?? fallback!;
  }

  private requireList(listId: string): TodoList {
    const row = this.db.prepare('SELECT * FROM todo_lists WHERE id = ?').get(listId) as
      | TodoListRow
      | undefined;
    if (!row) throw new Error('Todo list not found.');
    return this.mapList(row);
  }

  private requireStep(stepId: string): TodoStep {
    const row = this.db.prepare('SELECT * FROM todo_steps WHERE id = ?').get(stepId) as
      | TodoStepRow
      | undefined;
    if (!row) throw new Error('Todo step not found.');
    return this.mapStep(row);
  }

  private touchTodo(todoId: string): void {
    this.db.prepare('UPDATE todos SET updated_at = ? WHERE id = ?').run(Date.now(), todoId);
  }

  private getSteps(todoId: string): TodoStep[] {
    const rows = this.db
      .prepare('SELECT * FROM todo_steps WHERE todo_id = ? ORDER BY step_order ASC, created_at ASC')
      .all(todoId) as TodoStepRow[];
    return rows.map(row => this.mapStep(row));
  }

  private getStepsByTodoId(todoIds: string[]): Map<string, TodoStep[]> {
    const result = new Map<string, TodoStep[]>();
    if (todoIds.length === 0) return result;
    const placeholders = todoIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM todo_steps WHERE todo_id IN (${placeholders})
         ORDER BY step_order ASC, created_at ASC`,
      )
      .all(...todoIds) as TodoStepRow[];
    for (const row of rows) {
      const steps = result.get(row.todo_id) ?? [];
      steps.push(this.mapStep(row));
      result.set(row.todo_id, steps);
    }
    return result;
  }

  private mapTodo(row: TodoRow, steps: TodoStep[]): Todo {
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      status: row.status as Todo['status'],
      important: toBoolean(row.important),
      dueAt: row.due_at,
      remindAt: row.remind_at,
      listId: row.list_id,
      listName: row.list_name,
      myDayDate: row.my_day_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      sourceType: row.source_type as Todo['sourceType'],
      sourceId: row.source_id,
      steps,
    };
  }

  private mapList(row: TodoListRow): TodoList {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapStep(row: TodoStepRow): TodoStep {
    return {
      id: row.id,
      todoId: row.todo_id,
      title: row.title,
      completed: toBoolean(row.completed),
      order: row.step_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
