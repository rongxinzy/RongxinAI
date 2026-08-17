// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ProductionPlanItemStatus } from '../../../../shared/productionLoop';
import { useTodoQueueLifecycle } from './useTodoQueueLifecycle';

const originalElectron = window.electron;

afterEach(() => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: originalElectron,
  });
});

function mockCurrentProductionPlan(productionPlan: unknown) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      workbenchTask: {
        getCurrent: vi.fn().mockResolvedValue({
          success: true,
          detail: productionPlan ? { productionPlan } : null,
        }),
        onChanged: vi.fn(() => vi.fn()),
      },
    },
  });
}

test('shows todos from the persisted production plan', async () => {
  mockCurrentProductionPlan({
    runId: 'run-1',
    progressVersion: 1,
    items: [
      {
        id: 'domain-phase',
        title: 'Apply expert method',
        status: ProductionPlanItemStatus.InProgress,
      },
    ],
  });

  const view = renderHook(() =>
    useTodoQueueLifecycle({ isStreaming: true, sessionId: 'session-1' }),
  );

  await waitFor(() =>
    expect(view.result.current.todos).toEqual([
      {
        id: 'domain-phase',
        title: 'Apply expert method',
        description: undefined,
        status: 'in_progress',
      },
    ]),
  );
});

test('keeps the queue empty when no production plan exists', async () => {
  mockCurrentProductionPlan(null);

  const view = renderHook(() =>
    useTodoQueueLifecycle({ isStreaming: true, sessionId: 'session-1' }),
  );

  await waitFor(() => expect(view.result.current.todos).toEqual([]));
});
