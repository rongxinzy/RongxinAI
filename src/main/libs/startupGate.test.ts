import { expect, test } from 'vitest';

import { StartupGate } from './startupGate';

test('a start stays current until a stop cancels it', () => {
  const gate = new StartupGate();
  const first = gate.begin();

  expect(gate.isCurrent(first.token)).toBe(true);
  expect(first.signal.aborted).toBe(false);

  // Stopping during the runtime install must invalidate the start already
  // running and kill the child process it started.
  gate.cancel();
  expect(gate.isCurrent(first.token)).toBe(false);
  expect(first.signal.aborted).toBe(true);

  // A later attempt is unaffected by the older stop.
  const second = gate.begin();
  expect(gate.isCurrent(second.token)).toBe(true);
  expect(second.signal.aborted).toBe(false);
  expect(gate.isCurrent(first.token)).toBe(false);
});
