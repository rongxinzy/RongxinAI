// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { TodoStatus, TodoView as TodoViewFilter, type Todo } from '../../../shared/todo';
import { i18nService } from '../../services/i18n';
import { todayDateKey } from './todoUtils';
import TodoViewPage from './TodoView';

const t = (key: string): string => i18nService.t(key);

const makeTodo = (overrides: Partial<Todo>): Todo => ({
  id: 'todo-1',
  title: 'Task',
  note: '',
  status: TodoStatus.Active,
  important: false,
  dueAt: null,
  remindAt: null,
  listId: null,
  listName: null,
  myDayDate: null,
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  sourceType: 'manual',
  sourceId: null,
  steps: [],
  ...overrides,
});

interface ListRequest {
  view: string;
  query?: string;
}

const installTodoBridge = (bridge: {
  list: (request: ListRequest) => Todo[];
  update?: () => Promise<{ success: boolean }>;
}): { update: ReturnType<typeof vi.fn> } => {
  const update = vi.fn(bridge.update ?? (() => Promise.resolve({ success: true })));
  (window as unknown as { electron: unknown }).electron = {
    platform: 'win32',
    window: {
      isMaximized: () => Promise.resolve(false),
      onStateChanged: () => () => undefined,
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      showSystemMenu: vi.fn(),
    },
    todo: {
      list: vi.fn((request: ListRequest) =>
        Promise.resolve({ success: true, todos: bridge.list(request) }),
      ),
      listLists: vi.fn(() => Promise.resolve({ success: true, lists: [] })),
      update,
      create: vi.fn(),
      delete: vi.fn(),
      createList: vi.fn(),
      updateList: vi.fn(),
      deleteList: vi.fn(),
      createStep: vi.fn(),
      updateStep: vi.fn(),
      deleteStep: vi.fn(),
      onChanged: vi.fn(() => () => undefined),
    },
  };
  return { update };
};

test('keeps the detail sheet open when a completed task is marked active again', async () => {
  const completed = makeTodo({
    id: 'todo-9',
    title: 'Ship the release',
    status: TodoStatus.Completed,
    completedAt: 100,
  });
  let completedTodos: Todo[] = [completed];
  let activeTodos: Todo[] = [];
  const { update } = installTodoBridge({
    list: request => {
      if (request.view === TodoViewFilter.Completed) return completedTodos;
      if (request.view === TodoViewFilter.All) return activeTodos;
      return [];
    },
    update: () => {
      completedTodos = [];
      activeTodos = [{ ...completed, status: TodoStatus.Active, completedAt: null }];
      return Promise.resolve({ success: true });
    },
  });

  render(<TodoViewPage />);
  fireEvent.click(screen.getByRole('button', { name: /已完成/ }));
  const row = await screen.findByRole('button', { name: 'Ship the release' });
  fireEvent.click(row);

  const sheet = await screen.findByRole('dialog');
  fireEvent.click(within(sheet).getByRole('button', { name: t('todoMarkActive') }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

  // The task now leaves the completed snapshot; the sheet must follow it into
  // the active snapshot instead of closing mid-interaction.
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Ship the release' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('reports the searched row count instead of the unfiltered view total', async () => {
  const today = todayDateKey();
  const alpha = makeTodo({ id: 'alpha', title: 'Alpha report', myDayDate: today });
  const beta = makeTodo({ id: 'beta', title: 'Beta report', myDayDate: today });
  installTodoBridge({
    list: request => {
      if (request.view === TodoViewFilter.All) return [alpha, beta];
      if (request.view === TodoViewFilter.MyDay) {
        return request.query ? [alpha] : [alpha, beta];
      }
      return [];
    },
  });

  render(<TodoViewPage />);
  const countLabel = (count: number): string =>
    t('todoTaskCount').replace('{count}', String(count));
  expect(await screen.findByText(countLabel(2))).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(t('todoSearchPlaceholder')), {
    target: { value: 'Alpha' },
  });
  expect(await screen.findByText(countLabel(1))).toBeInTheDocument();
});
