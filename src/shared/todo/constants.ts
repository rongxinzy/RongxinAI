export const TodoStatus = {
  Active: 'active',
  Completed: 'completed',
} as const;
export type TodoStatus = (typeof TodoStatus)[keyof typeof TodoStatus];

export const TodoView = {
  MyDay: 'my_day',
  Important: 'important',
  Planned: 'planned',
  All: 'all',
  Completed: 'completed',
} as const;
export type TodoView = (typeof TodoView)[keyof typeof TodoView];

export const TodoSourceType = {
  Manual: 'manual',
} as const;
export type TodoSourceType = (typeof TodoSourceType)[keyof typeof TodoSourceType];

export const TodoIpc = {
  List: 'todo:list',
  Create: 'todo:create',
  Update: 'todo:update',
  Delete: 'todo:delete',
  ListLists: 'todo:lists:list',
  CreateList: 'todo:lists:create',
  UpdateList: 'todo:lists:update',
  DeleteList: 'todo:lists:delete',
  CreateStep: 'todo:steps:create',
  UpdateStep: 'todo:steps:update',
  DeleteStep: 'todo:steps:delete',
  Changed: 'todo:changed',
} as const;
export type TodoIpc = (typeof TodoIpc)[keyof typeof TodoIpc];
