import { expect, test } from 'vitest';

import { CodingEventKind, type CodingRoomSnapshot } from '../../../shared/codingAgent';
import { mergeCodingRoomEventDelta } from './codingEventDelta';

const snapshot = (): CodingRoomSnapshot => ({
  room: {
    id: 'room',
    name: 'room',
    workspaceRoot: '/workspace',
    defaultProfileId: 'builtin',
    activeMissionId: 'mission',
    activeLaneId: 'lane',
  },
  profiles: [],
  missions: [],
  lanes: [],
  assignments: [],
  events: [
    {
      id: 'event-1',
      laneId: 'lane',
      sequence: 1,
      kind: CodingEventKind.Message,
      payload: { content: 'old' },
      createdAt: 1,
    },
  ],
  eventWindows: [{ laneId: 'lane', oldestSequence: 1, newestSequence: 1, hasMore: false }],
  elicitations: [],
});

test('upserts streamed events without duplicating the event id', () => {
  const result = mergeCodingRoomEventDelta(snapshot(), {
    workspaceRoot: '/workspace',
    events: [
      {
        id: 'event-1',
        laneId: 'lane',
        sequence: 1,
        kind: CodingEventKind.Message,
        payload: { content: 'updated' },
        createdAt: 1,
      },
      {
        id: 'event-2',
        laneId: 'lane',
        sequence: 2,
        kind: CodingEventKind.Message,
        payload: { content: 'new' },
        createdAt: 2,
      },
    ],
  });

  expect(result.events).toHaveLength(2);
  expect(result.events.map(event => event.payload.content)).toEqual(['updated', 'new']);
});
