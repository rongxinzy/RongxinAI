import { expect, test } from 'vitest';

import { ProductionPlanItemStatus } from '../../../../shared/productionLoop';
import { productionPlanToTodoSource } from './useProductionPlanTodos';

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
