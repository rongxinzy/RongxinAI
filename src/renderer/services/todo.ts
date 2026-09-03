import type {
  Todo,
  TodoActionResult,
  TodoCreateInput,
  TodoList,
  TodoListActionResult,
  TodoListInput,
  TodoListResult,
  TodoListsResult,
  TodoListUpdateInput,
  TodoStepActionResult,
  TodoStepCreateInput,
  TodoStepUpdateInput,
  TodoUpdateInput,
} from '../../shared/todo';

export const todoService = {
  async list(input: TodoListInput): Promise<TodoListResult> {
    return await window.electron.todo.list(input);
  },

  async create(input: TodoCreateInput): Promise<TodoActionResult> {
    return await window.electron.todo.create(input);
  },

  async update(todoId: string, input: TodoUpdateInput): Promise<TodoActionResult> {
    return await window.electron.todo.update({ todoId, ...input });
  },

  async delete(todoId: string): Promise<{ success: boolean; error?: string }> {
    return await window.electron.todo.delete(todoId);
  },

  async listLists(): Promise<TodoListsResult> {
    return await window.electron.todo.listLists();
  },

  async createList(input: { name: string }): Promise<TodoListActionResult> {
    return await window.electron.todo.createList(input);
  },

  async updateList(listId: string, input: TodoListUpdateInput): Promise<TodoListActionResult> {
    return await window.electron.todo.updateList({ listId, ...input });
  },

  async deleteList(listId: string): Promise<{ success: boolean; error?: string }> {
    return await window.electron.todo.deleteList(listId);
  },

  async createStep(input: TodoStepCreateInput): Promise<TodoStepActionResult> {
    return await window.electron.todo.createStep(input);
  },

  async updateStep(input: TodoStepUpdateInput): Promise<TodoStepActionResult> {
    return await window.electron.todo.updateStep(input);
  },

  async deleteStep(stepId: string): Promise<{ success: boolean; error?: string }> {
    return await window.electron.todo.deleteStep(stepId);
  },
};

export type TodoServiceTodo = Todo;
export type TodoServiceList = TodoList;
