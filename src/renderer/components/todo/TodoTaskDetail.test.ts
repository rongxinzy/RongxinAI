// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { TodoSourceType, TodoStatus, type Todo, type TodoActionResult } from '../../../shared/todo';
import { todoService } from '../../services/todo';
import TodoTaskDetail from './TodoTaskDetail';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../services/todo', () => ({ todoService: { update: vi.fn() } }));

const todo: Todo = {
  id: 'task',
  title: 'Original title',
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
  sourceType: TodoSourceType.Manual,
  sourceId: null,
  steps: [],
};

beforeEach(() => vi.clearAllMocks());

const renderDetail = () => {
  const onSaved = vi.fn();
  const onUpdated = vi.fn().mockResolvedValue(undefined);
  render(
    createElement(TodoTaskDetail, {
      todo,
      lists: [],
      language: 'en',
      onSaved,
      onUpdated,
      onError: vi.fn(),
      onDelete: vi.fn(),
    }),
  );
  return { user: userEvent.setup(), onSaved, onUpdated };
};

test.each(['todoTitleLabel', 'todoNote'])(
  'saves %s with the first click and waits for persistence',
  async label => {
    let finish!: (result: TodoActionResult) => void;
    vi.mocked(todoService.update).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const { user, onSaved, onUpdated } = renderDetail();
    await user.clear(screen.getByRole('textbox', { name: label }));
    await user.type(screen.getByRole('textbox', { name: label }), 'Changed text');
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(todoService.update).toHaveBeenCalledTimes(1);
    expect(todoService.update).toHaveBeenCalledWith(
      todo.id,
      expect.objectContaining(
        label === 'todoTitleLabel' ? { title: 'Changed text' } : { note: 'Changed text' },
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'saving' })).toBeDisabled();
    await act(async () => finish({ success: true }));
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
  },
);

test('keeps details open and permits retry after a failed save', async () => {
  vi.mocked(todoService.update).mockResolvedValue({ success: false });
  const { user, onSaved } = renderDetail();
  await user.type(screen.getByRole('textbox', { name: 'todoNote' }), 'Draft');
  await user.click(screen.getByRole('button', { name: 'save' }));
  expect(todoService.update).toHaveBeenCalledOnce();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'save' })).toBeEnabled();
});

test('preserves an edited note when a background refresh replaces the same task', async () => {
  vi.mocked(todoService.update).mockResolvedValue({ success: true });
  const onSaved = vi.fn();
  const props = {
    todo,
    lists: [],
    language: 'en' as const,
    onSaved,
    onUpdated: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    onDelete: vi.fn(),
  };
  const view = render(createElement(TodoTaskDetail, props));
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'todoNote' }), 'Keep this draft');
  view.rerender(createElement(TodoTaskDetail, { ...props, todo: { ...todo, updatedAt: 1 } }));
  expect(screen.getByRole('textbox', { name: 'todoNote' })).toHaveValue('Keep this draft');
  await user.click(screen.getByRole('button', { name: 'save' }));
  expect(todoService.update).toHaveBeenCalledWith(
    todo.id,
    expect.objectContaining({ note: 'Keep this draft' }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
});

test('autosaves when keyboard navigation passes Save without activating it', async () => {
  vi.mocked(todoService.update).mockResolvedValue({ success: true });
  const { user, onSaved } = renderDetail();
  await user.type(screen.getByRole('textbox', { name: 'todoNote' }), 'Draft');
  // Focusing Save hands submission to the button; moving away still commits the draft.
  act(() => screen.getByRole('button', { name: 'save' }).focus());
  expect(todoService.update).not.toHaveBeenCalled();
  await user.tab();
  await waitFor(() => expect(todoService.update).toHaveBeenCalledOnce());
  expect(onSaved).not.toHaveBeenCalled();
});
