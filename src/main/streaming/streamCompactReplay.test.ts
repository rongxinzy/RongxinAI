import { expect, test } from 'vitest';

import { buildCompactReplay } from './streamCompactReplay';

test('merges contiguous text deltas and synthesizes missing start', () => {
  const replay = buildCompactReplay([
    {
      sessionId: 's',
      messageId: 'm',
      chunk: { type: 'text-delta', id: 'p1', delta: 'hel' },
    },
    {
      sessionId: 's',
      messageId: 'm',
      chunk: { type: 'text-delta', id: 'p1', delta: 'lo' },
    },
    { sessionId: 's', messageId: 'm', chunk: { type: 'text-end', id: 'p1' } },
  ]);
  expect(replay.map(entry => entry.chunk.type)).toEqual(['text-start', 'text-delta', 'text-end']);
  expect(replay[1].chunk).toMatchObject({ type: 'text-delta', delta: 'hello' });
});
