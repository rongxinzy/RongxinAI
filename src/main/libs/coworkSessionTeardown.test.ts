import { describe, expect, test, vi } from 'vitest';

import { teardownCascadeDeletedSessions } from './coworkSessionTeardown';

describe('teardownCascadeDeletedSessions', () => {
  test('purges runtime state and IM mappings for every session in order', () => {
    const onSessionDeleted = vi.fn();
    const deleteImMapping = vi.fn();

    teardownCascadeDeletedSessions(['session-a', 'session-b'], {
      onSessionDeleted,
      deleteImMapping,
    });

    expect(onSessionDeleted.mock.calls).toEqual([['session-a'], ['session-b']]);
    expect(deleteImMapping.mock.calls).toEqual([['session-a'], ['session-b']]);
    // All runtime purges complete before the first IM mapping is touched.
    expect(onSessionDeleted.mock.invocationCallOrder[1]).toBeLessThan(
      deleteImMapping.mock.invocationCallOrder[0],
    );
  });

  test('a throwing purge does not abort the rest of the cascade', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onSessionDeleted = vi.fn((sessionId: string) => {
        if (sessionId === 'session-a') throw new Error('listener threw');
      });
      const deleteImMapping = vi.fn();

      teardownCascadeDeletedSessions(['session-a', 'session-b'], {
        onSessionDeleted,
        deleteImMapping,
      });

      expect(onSessionDeleted.mock.calls).toHaveLength(2);
      expect(deleteImMapping.mock.calls).toEqual([['session-a'], ['session-b']]);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toContain('session-a');
    } finally {
      consoleError.mockRestore();
    }
  });

  test('IM mapping failures are swallowed and logged nowhere', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onSessionDeleted = vi.fn();
      const deleteImMapping = vi.fn(() => {
        throw new Error('IM store unavailable');
      });

      expect(() =>
        teardownCascadeDeletedSessions(['session-a'], { onSessionDeleted, deleteImMapping }),
      ).not.toThrow();
      expect(onSessionDeleted).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('is a no-op for an empty cascade', () => {
    const onSessionDeleted = vi.fn();
    const deleteImMapping = vi.fn();

    teardownCascadeDeletedSessions([], { onSessionDeleted, deleteImMapping });

    expect(onSessionDeleted).not.toHaveBeenCalled();
    expect(deleteImMapping).not.toHaveBeenCalled();
  });
});
