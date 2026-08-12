import { expect, test, vi } from 'vitest';

import { StreamRequestRegistry } from './streamRequestRegistry';

test('cleans up only the completed stream request', () => {
  const registry = new StreamRequestRegistry();
  const cleanFirst = vi.fn();
  const cleanSecond = vi.fn();

  registry.register('first', [cleanFirst]);
  registry.register('second', [cleanSecond]);
  registry.cleanup('first');

  expect(cleanFirst).toHaveBeenCalledOnce();
  expect(cleanSecond).not.toHaveBeenCalled();
  expect(registry.getLatestRequestId()).toBe('second');
});
