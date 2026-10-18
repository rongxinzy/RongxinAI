import type Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';

import { TodoIpc, type TodoChangedEvent, type TodoListUpdateInput } from '../../shared/todo';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { todoContract } from '../../shared/ipc/todoContract';
import { TodoRepository } from './repository';

interface TodoIpcOptions {
  onMutation?: () => void;
}

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

  handleIpcContract(todoContract, {
    list: (_event, input) => {
      try {
        return { success: true as const, todos: repository.list(input) };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    create: (_event, input) => {
      try {
        const todo = repository.create(input);
        notifyMutation({ todoId: todo.id, listId: todo.listId ?? undefined });
        return { success: true as const, todo };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    update: (_event, input) => {
      try {
        const { todoId, ...fields } = input;
        const todo = repository.update(todoId, fields);
        notifyMutation({ todoId: todo.id, listId: todo.listId ?? undefined });
        return { success: true as const, todo };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    delete: (_event, todoId) => {
      try {
        repository.delete(todoId);
        notifyMutation({ todoId });
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    listLists: () => {
      try {
        return { success: true as const, lists: repository.listLists() };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    createList: (_event, input) => {
      try {
        const list = repository.createList(input.name);
        notifyMutation({ listId: list.id });
        return { success: true as const, list };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    updateList: (_event, input) => {
      try {
        const update: TodoListUpdateInput = { name: input.name };
        const list = repository.updateList(input.listId, update);
        notifyMutation({ listId: list.id });
        return { success: true as const, list };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    deleteList: (_event, listId) => {
      try {
        repository.deleteList(listId);
        notifyMutation({ listId });
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    createStep: (_event, input) => {
      try {
        const step = repository.createStep(input);
        notifyMutation({ todoId: step.todoId });
        return { success: true as const, step };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    updateStep: (_event, input) => {
      try {
        const step = repository.updateStep(input);
        notifyMutation({ todoId: step.todoId });
        return { success: true as const, step };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },

    deleteStep: (_event, stepId) => {
      try {
        repository.deleteStep(stepId);
        notifyMutation({});
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error: errorMessage(error) };
      }
    },
  });
}
