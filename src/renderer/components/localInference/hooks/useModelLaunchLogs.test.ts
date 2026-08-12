import { expect, test } from 'vitest';

import { shouldCloseLaunchLogPanelForModel } from './useModelLaunchLogs';

test('only closes the log panel when unloading its active model', () => {
  const panel = { modelName: 'A' };

  expect(shouldCloseLaunchLogPanelForModel(panel, 'A')).toBe(true);
  expect(shouldCloseLaunchLogPanelForModel(panel, 'B')).toBe(false);
});