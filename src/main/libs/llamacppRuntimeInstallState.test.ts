import { expect, test } from 'vitest';

import { createLlamaCppRuntimeInstallState } from './llamacppRuntimeInstallState';

test('retains runtime install progress while the task is active', () => {
  const state = createLlamaCppRuntimeInstallState();

  state.start();
  state.update({ phase: 'downloading-progress', percent: 42, modelName: 'b9244/win-x64' });

  expect(state.snapshot()).toEqual({
    active: true,
    progress: { phase: 'downloading-progress', percent: 42, modelName: 'b9244/win-x64' },
  });
});

test('does not expose a completed runtime install from a restored snapshot', () => {
  const state = createLlamaCppRuntimeInstallState();

  state.start();
  state.update({ phase: 'done', percent: 100 });

  expect(state.snapshot()).toEqual({ active: false });
});
