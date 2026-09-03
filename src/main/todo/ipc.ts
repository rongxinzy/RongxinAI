import type Database from 'better-sqlite3';
import { BrowserWindow, ipcMain } from 'electron';

import {
  TodoIpc,
  TodoStatus,
  TodoView,
  type TodoChangedEvent,
  type TodoCreateInput,
  type TodoListInput,
  type TodoListUpdateInput,
  type TodoStepCreateInput,
  type TodoStepUpdateInput,
  type TodoUpdateInput,
} from '../../shared/todo';
import { TodoRepository } from './repository';

interface TodoIpcOptions {
  onMutation?: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
};

const optionalText = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null.`);
  return value;
};

const optionalId = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined) return undefined;
  return optionalText(value, field);
};

const optionalTimestamp = (value: unknown, field: string): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite timestamp or null.`);
  }
  return value;
};

const parseView = (value: unknown): TodoView => {
  if (typeof value !== 'string' || !Object.values(TodoView).includes(value as TodoView)) {
    throw new Error('Todo view is invalid.');
  }
  return value as TodoView;
};

const parseListInput = (value: unknown): TodoListInput => {
  if (!isRecord(value)) throw new Error('Todo list input is invalid.');
  return {
    view: parseView(value.view),
    listId: optionalId(value.listId, 'listId'),
    query: typeof value.query === 'string' ? value.query : undefined,
    referenceDate: typeof value.referenceDate === 'string' ? value.referenceDate : undefined,
  };
};

const parseCreateInput = (value: unknown): TodoCreateInput => {
  if (!isRecord(value)) throw new Error('Todo input is invalid.');
  return {
    title: requiredText(value.title, 'title'),
    note: typeof value.note === 'string' ? value.note : undefined,
    important: typeof value.important === 'boolean' ? value.important : undefined,
    dueAt: optionalTimestamp(value.dueAt, 'dueAt'),
    remindAt: optionalTimestamp(value.remindAt, 'remindAt'),
    listId: optionalId(value.listId, 'listId'),
    myDayDate: optionalText(value.myDayDate, 'myDayDate'),
  };
};

const parseUpdateInput = (value: unknown): { todoId: string; input: TodoUpdateInput } => {
  if (!isRecord(value)) throw new Error('Todo update input is invalid.');
  const todoId = requiredText(value.todoId, 'todoId');
  const input: TodoUpdateInput = {};
  if ('title' in value) input.title = requiredText(value.title, 'title');
  if ('note' in value) input.note = typeof value.note === 'string' ? value.note : '';
  if ('status' in value) {
    if (value.status !== TodoStatus.Active && value.status !== TodoStatus.Completed) {
      throw new Error('Todo status is invalid.');
    }
    input.status = value.status;
  }
  if ('important' in value) {
    if (typeof value.important !== 'boolean') throw new Error('important must be a boolean.');
    input.important = value.important;
  }
  if ('dueAt' in value) input.dueAt = optionalTimestamp(value.dueAt, 'dueAt');
  if ('remindAt' in value) input.remindAt = optionalTimestamp(value.remindAt, 'remindAt');
  if ('listId' in value) input.listId = optionalId(value.listId, 'listId');
  if ('myDayDate' in value) input.myDayDate = optionalText(value.myDayDate, 'myDayDate');
  return { todoId, input };
};

const parseListName = (value: unknown): string => {
  if (!isRecord(value)) throw new Error('Todo list input is invalid.');
  return requiredText(value.name, 'name');
};

const parseStepCreateInput = (value: unknown): TodoStepCreateInput => {
  if (!isRecord(value)) throw new Error('Todo step input is invalid.');
  return {
    todoId: requiredText(value.todoId, 'todoId'),
    title: requiredText(value.title, 'title'),
  };
};

const parseStepUpdateInput = (value: unknown): TodoStepUpdateInput => {
  if (!isRecord(value)) throw new Error('Todo step update input is invalid.');
  const input: TodoStepUpdateInput = {
    id: requiredText(value.id, 'id'),
  };
  if ('title' in value) input.title = requiredText(value.title, 'title');
  if ('completed' in value) {
    if (typeof value.completed !== 'boolean') throw new Error('completed must be a boolean.');
    input.completed = value.completed;
  }
  if ('order' in value) {
    if (typeof value.order !== 'number' || !Number.isInteger(value.order) || value.order < 0) {
      throw new Error('order must be a non-negative integer.');
    }
    input.order = value.order;
  }
  return input;
};

const parseId = (value: unknown, field: string): string => requiredText(value, field);

const broadcastChanged = (event: TodoChangedEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(TodoIpc.Changed, event);
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function registerTodoIpcHandlers(
  getDatabase: () => Database.Database,
  options: TodoIpcOptions = {},
): void {
  const repository = new TodoRepository(getDatabase());
  const notifyMutation = (event: TodoChangedEvent): void => {
    broadcastChanged(event);
    options.onMutation?.();
  };

  ipcMain.handle(TodoIpc.List, (_event, rawInput: unknown) => {
    try {
      return { success: true, todos: repository.list(parseListInput(rawInput)) };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.Create, (_event, rawInput: unknown) => {
    try {
      const todo = repository.create(parseCreateInput(rawInput));
      notifyMutation({ todoId: todo.id, listId: todo.listId ?? undefined });
      return { success: true, todo };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.Update, (_event, rawInput: unknown) => {
    try {
      const { todoId, input } = parseUpdateInput(rawInput);
      const todo = repository.update(todoId, input);
      notifyMutation({ todoId: todo.id, listId: todo.listId ?? undefined });
      return { success: true, todo };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.Delete, (_event, rawId: unknown) => {
    try {
      const todoId = parseId(rawId, 'todoId');
      repository.delete(todoId);
      notifyMutation({ todoId });
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.ListLists, () => {
    try {
      return { success: true, lists: repository.listLists() };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.CreateList, (_event, rawInput: unknown) => {
    try {
      const list = repository.createList(parseListName(rawInput));
      notifyMutation({ listId: list.id });
      return { success: true, list };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.UpdateList, (_event, rawInput: unknown) => {
    try {
      if (!isRecord(rawInput)) throw new Error('Todo list input is invalid.');
      const listId = parseId(rawInput.listId, 'listId');
      const input: TodoListUpdateInput = { name: parseListName(rawInput) };
      const list = repository.updateList(listId, input);
      notifyMutation({ listId: list.id });
      return { success: true, list };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.DeleteList, (_event, rawId: unknown) => {
    try {
      const listId = parseId(rawId, 'listId');
      repository.deleteList(listId);
      notifyMutation({ listId });
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.CreateStep, (_event, rawInput: unknown) => {
    try {
      const step = repository.createStep(parseStepCreateInput(rawInput));
      notifyMutation({ todoId: step.todoId });
      return { success: true, step };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.UpdateStep, (_event, rawInput: unknown) => {
    try {
      const step = repository.updateStep(parseStepUpdateInput(rawInput));
      notifyMutation({ todoId: step.todoId });
      return { success: true, step };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(TodoIpc.DeleteStep, (_event, rawId: unknown) => {
    try {
      const stepId = parseId(rawId, 'stepId');
      repository.deleteStep(stepId);
      notifyMutation({});
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });
}
