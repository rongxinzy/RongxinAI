import { expect, test } from 'vitest';

import { WorkMode } from './constants';
import reducer, { setWorkMode } from './workModeSlice';

test('defaults to work mode', () => {
  expect(reducer(undefined, { type: 'unknown' }).mode).toBe(WorkMode.Work);
});

test('switches the global mode', () => {
  const workState = reducer(undefined, { type: 'unknown' });

  expect(reducer(workState, setWorkMode(WorkMode.Chat)).mode).toBe(WorkMode.Chat);
});
