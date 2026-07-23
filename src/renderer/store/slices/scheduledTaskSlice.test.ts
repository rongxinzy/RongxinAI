import { expect, test } from 'vitest';

import scheduledTaskReducer, { setListError, setTasks } from './scheduledTaskSlice';

test('keeps task-list errors separate from operation errors', () => {
  const failedState = scheduledTaskReducer(undefined, setListError('gateway unavailable'));

  expect(failedState.listError).toBe('gateway unavailable');
  expect(failedState.error).toBeNull();

  const recoveredState = scheduledTaskReducer(failedState, setTasks([]));
  expect(recoveredState.listError).toBeNull();
});
