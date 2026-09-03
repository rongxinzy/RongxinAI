import type { TodoSourceType, TodoStatus, TodoView } from './constants';

export interface TodoList {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface TodoStep {
  id: string;
  todoId: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Todo {
  id: string;
  title: string;
  note: string;
  status: TodoStatus;
  important: boolean;
  dueAt: number | null;
  remindAt: number | null;
  listId: string | null;
  listName: string | null;
  myDayDate: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  sourceType: TodoSourceType;
  sourceId: string | null;
  steps: TodoStep[];
}

export interface TodoListInput {
  view: TodoView;
  listId?: string | null;
  query?: string;
  referenceDate?: string;
}

export interface TodoCreateInput {
  title: string;
  note?: string;
  important?: boolean;
  dueAt?: number | null;
  remindAt?: number | null;
  listId?: string | null;
  myDayDate?: string | null;
  sourceType?: TodoSourceType;
  sourceId?: string | null;
}

export interface TodoUpdateInput {
  title?: string;
  note?: string;
  status?: TodoStatus;
  important?: boolean;
  dueAt?: number | null;
  remindAt?: number | null;
  listId?: string | null;
  myDayDate?: string | null;
}

export interface TodoListCreateInput {
  name: string;
}

export interface TodoListUpdateInput {
  name: string;
}

export interface TodoStepCreateInput {
  todoId: string;
  title: string;
}

export interface TodoStepUpdateInput {
  id: string;
  title?: string;
  completed?: boolean;
  order?: number;
}

export interface TodoActionResult {
  success: boolean;
  todo?: Todo;
  error?: string;
}

export interface TodoListResult {
  success: boolean;
  todos?: Todo[];
  error?: string;
}

export interface TodoListsResult {
  success: boolean;
  lists?: TodoList[];
  error?: string;
}

export interface TodoListActionResult {
  success: boolean;
  list?: TodoList;
  error?: string;
}

export interface TodoStepActionResult {
  success: boolean;
  step?: TodoStep;
  error?: string;
}

export interface TodoChangedEvent {
  todoId?: string;
  listId?: string;
}
