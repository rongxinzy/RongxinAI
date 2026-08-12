// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ProductionPlanItemStatus } from '../../../../shared/productionLoop';
import { productionPlanToTodoSource, useProductionPlanTodos } from './useProductionPlanTodos';

const originalElectron = window.electron;

afterEach(() => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: originalElectron,
  });
});

test('maps persisted production plan items to todo queue states', () => {
  const result = productionPlanToTodoSource({
    runId: 'run-1',
    progressVersion: 4,
    items: [
      { id: 'a', title: 'Pending', status: ProductionPlanItemStatus.Pending },
      { id: 'b', title: 'Active', status: ProductionPlanItemStatus.InProgress },
      { id: 'c', title: 'Done', status: ProductionPlanItemStatus.Completed },
      { id: 'd', title: 'Blocked', status: ProductionPlanItemStatus.Blocked },
    ],
  });

  expect(result).toEqual({
    runId: 'run-1',
    progressVersion: 4,
    todos: [
      { id: 'a', title: 'Pending', description: undefined, status: 'pending' },
      { id: 'b', title: 'Active', description: undefined, status: 'in_progress' },
      { id: 'c', title: 'Done', description: undefined, status: 'completed' },
      { id: 'd', title: 'Blocked', description: undefined, status: 'blocked' },
    ],
  });
});

test('ignores an older production plan response after the active run changes', async () => {
  const pending: Array<(value: unknown) => void> = [];
  const getCurrent = vi.fn(
    () =>
      new Promise(resolve => {
        pending.push(resolve);
      }),
  );
  let onChanged: ((event: { sessionId: string }) => void) | undefined;
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      workbenchTask: {
        getCurrent,
        onChanged: vi.fn(callback => {
          onChanged = callback;
          return vi.fn();
        }),
      },
    },
  });

  const view = renderHook(() => useProductionPlanTodos('session-1'));
  await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(1));
  act(() => onChanged?.({ sessionId: 'session-1' }));
  await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));

  await act(async () => {
    pending[1]?.({
      success: true,
      detail: {
        productionPlan: {
          runId: 'run-b',
          progressVersion: 2,
          items: [{ id: 'b', title: 'New run', status: ProductionPlanItemStatus.InProgress }],
        },
      },
    });
  });
  await waitFor(() => expect(view.result.current?.runId).toBe('run-b'));

  await act(async () => {
    pending[0]?.({
      success: true,
      detail: {
        productionPlan: {
          runId: 'run-a',
          progressVersion: 1,
          items: [{ id: 'a', title: 'Old run', status: ProductionPlanItemStatus.Pending }],
        },
      },
    });
  });

  expect(view.result.current?.runId).toBe('run-b');
});
