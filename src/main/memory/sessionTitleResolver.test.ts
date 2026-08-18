import type Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { resolveMemorySessionTitles } from './sessionTitleResolver';

test('resolves unique trimmed session ids and ignores empty titles', () => {
  const all = vi.fn(() => [
    { id: 'session-a', title: ' Session A ' },
    { id: 'session-b', title: '   ' },
  ]);
  const prepare = vi.fn(() => ({ all }));

  const titles = resolveMemorySessionTitles({ prepare } as unknown as Database.Database, [
    ' session-a ',
    '',
    'session-a',
    'session-b',
  ]);

  expect(all).toHaveBeenCalledWith('session-a', 'session-b');
  expect(titles).toEqual([{ sessionId: 'session-a', title: 'Session A' }]);
});

test('queries large session sets in bounded batches', () => {
  const all = vi.fn((...sessionIds: string[]) =>
    sessionIds.map(sessionId => ({ id: sessionId, title: sessionId })),
  );
  const prepare = vi.fn(() => ({ all }));
  const sessionIds = Array.from({ length: 501 }, (_, index) => `session-${index}`);

  const titles = resolveMemorySessionTitles(
    { prepare } as unknown as Database.Database,
    sessionIds,
  );

  expect(prepare).toHaveBeenCalledTimes(2);
  expect(all.mock.calls[0]).toHaveLength(500);
  expect(all.mock.calls[1]).toHaveLength(1);
  expect(titles).toHaveLength(501);
});
