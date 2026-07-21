import { expect, test } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import { selectIsStreaming } from './coworkSelectors';

test('selectIsStreaming follows the current session status instead of a stale global flag', () => {
  const state = {
    cowork: {
      isStreaming: false,
      currentSession: { id: 'work-1', status: CoworkSessionStatusValue.Running },
    },
  };

  expect(selectIsStreaming(state as never)).toBe(true);
});

test('selectIsStreaming is false without a running current session', () => {
  expect(selectIsStreaming({ cowork: { isStreaming: true, currentSession: null } } as never)).toBe(
    false,
  );
  expect(
    selectIsStreaming({
      cowork: { isStreaming: true, currentSession: { status: CoworkSessionStatusValue.Completed } },
    } as never),
  ).toBe(false);
});
