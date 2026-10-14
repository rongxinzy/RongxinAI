import { expect, test } from 'vitest';

import { StartupGate } from './startupGate';

test('a start stays current until a stop cancels it', () => {
  const gate = new StartupGate();
  const first = gate.begin();

  expect(gate.isCurrent(first)).toBe(true);

  // Stopping during the runtime install must invalidate the start already running.
  gate.cancel();
  expect(gate.isCurrent(first)).toBe(false);

  // A later attempt is unaffected by the older stop.
  const second = gate.begin();
  expect(gate.isCurrent(second)).toBe(true);
  expect(gate.isCurrent(first)).toBe(false);
});
