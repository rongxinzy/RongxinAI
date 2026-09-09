// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { TodoStatus, type Todo } from '../../../shared/todo';
import { fromDateInputValue } from './todoUtils';
import TodoTaskDetail from './TodoTaskDetail';

const todo: Todo = {
  id: 'todo-1',
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
  sourceType: 'manual',
  sourceId: null,
  steps: [],
};

const renderDetail = (
  update: (input: unknown) => Promise<unknown>,
  onUpdated: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) => {
  (window as unknown as { electron: unknown }).electron = {
    todo: {
      update,
      createStep: vi.fn(),
      updateStep: vi.fn(),
      deleteStep: vi.fn(),
    },
  };
  return render(
    <TodoTaskDetail
      todo={todo}
      lists={[]}
      language="en"
      onUpdated={onUpdated}
      onError={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
};

test('saves only the edited fields with their current local values', async () => {
  const update = vi.fn().mockResolvedValue({ success: true });
  const { container } = renderDetail(update);

  const titleInput = container.querySelector<HTMLInputElement>(
    '.theme-page-todo-task-detail-input-1',
  );
  expect(titleInput).not.toBeNull();
  fireEvent.change(titleInput!, { target: { value: 'Renamed' } });
  fireEvent.blur(titleInput!);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  // Untouched fields must not be part of the payload, so a full save can
  // never clobber newer server values (e.g. from another window).
  expect(update).toHaveBeenCalledWith({ todoId: todo.id, title: 'Renamed' });

  const dueInput = container.querySelector<HTMLInputElement>('input[type="date"]');
  expect(dueInput).not.toBeNull();
  fireEvent.change(dueInput!, { target: { value: '2026-09-15' } });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith({
    todoId: todo.id,
    dueAt: fromDateInputValue('2026-09-15'),
  });
});

test('an edit made while a save is in flight keeps its value after the save resolves', async () => {
  let resolveFirstSave: (result: { success: boolean }) => void = () => undefined;
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ success: boolean }>(resolve => {
          resolveFirstSave = resolve;
        }),
    )
    .mockResolvedValue({ success: true });
  const { container, rerender } = renderDetail(update);

  const titleInput = container.querySelector<HTMLInputElement>(
    '.theme-page-todo-task-detail-input-1',
  )!;
  fireEvent.change(titleInput, { target: { value: 'First edit' } });
  fireEvent.blur(titleInput);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith({ todoId: todo.id, title: 'First edit' });

  // The user retitles again while the first save is still in flight.
  fireEvent.change(titleInput, { target: { value: 'Second edit' } });
  resolveFirstSave({ success: true });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

  // The refresh following the first save delivers a stale server snapshot;
  // the in-progress second edit must survive it.
  rerender(
    <TodoTaskDetail
      todo={{ ...todo, title: 'First edit', updatedAt: 1 }}
      lists={[]}
      language="en"
      onUpdated={vi.fn().mockResolvedValue(undefined)}
      onError={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  expect(titleInput.value).toBe('Second edit');

  fireEvent.blur(titleInput);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith({ todoId: todo.id, title: 'Second edit' });
});

test('only the latest save of a field reacts to its response when returns are out of order', async () => {
  let resolveFirstSave: (result: { success: boolean }) => void = () => undefined;
  const onUpdated = vi.fn().mockResolvedValue(undefined);
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ success: boolean }>(resolve => {
          resolveFirstSave = resolve;
        }),
    )
    .mockResolvedValue({ success: true });
  const { container } = renderDetail(update, onUpdated);

  const titleInput = container.querySelector<HTMLInputElement>(
    '.theme-page-todo-task-detail-input-1',
  )!;
  fireEvent.change(titleInput, { target: { value: 'Save A' } });
  fireEvent.blur(titleInput);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

  // A second save for the same field is issued and resolves before the first.
  fireEvent.change(titleInput, { target: { value: 'Save B' } });
  fireEvent.blur(titleInput);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  expect(titleInput.value).toBe('Save B');

  // The stale first response must neither clear the field state nor refresh.
  resolveFirstSave({ success: true });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(titleInput.value).toBe('Save B');
});
