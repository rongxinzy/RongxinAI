import { expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingStreamContentLengthField,
  CodingStreamUpdateMode,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
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

test('appends a suffix and ignores a repeat of the same length', () => {
  const base = snapshot();
  base.events[0] = {
    ...base.events[0],
    payload: { content: 'hel', streamUpdateMode: CodingStreamUpdateMode.Append },
  };
  const suffix = {
    ...base.events[0],
    payload: {
      content: 'lo',
      streamUpdateMode: CodingStreamUpdateMode.Append,
      [CodingStreamContentLengthField]: 5,
    },
  };

  const appended = mergeCodingRoomEventDelta(base, {
    workspaceRoot: '/workspace',
    events: [suffix],
  });
  expect(appended.events[0].payload.content).toBe('hello');
  expect(appended.events[0].payload).not.toHaveProperty(CodingStreamContentLengthField);

  const repeated = mergeCodingRoomEventDelta(appended, {
    workspaceRoot: '/workspace',
    events: [
      {
        ...suffix,
        payload: {
          content: '',
          streamUpdateMode: CodingStreamUpdateMode.Append,
          [CodingStreamContentLengthField]: 5,
        },
      },
    ],
  });
  expect(repeated).toBe(appended);
  expect(repeated.events[0]).toBe(appended.events[0]);
});

test('treats a frame whose content length matches the target as the full text', () => {
  const base = snapshot();
  const full = mergeCodingRoomEventDelta(base, {
    workspaceRoot: '/workspace',
    events: [
      {
        ...base.events[0],
        payload: {
          content: 'hello',
          streamUpdateMode: CodingStreamUpdateMode.Replace,
          [CodingStreamContentLengthField]: 5,
        },
      },
    ],
  });
  expect(full.events[0].payload.content).toBe('hello');

  const same = mergeCodingRoomEventDelta(full, {
    workspaceRoot: '/workspace',
    events: [
      {
        ...base.events[0],
        payload: {
          content: 'hello',
          streamUpdateMode: CodingStreamUpdateMode.Replace,
          [CodingStreamContentLengthField]: 5,
        },
      },
    ],
  });
  expect(same).toBe(full);
});

test('keeps the current text when a suffix does not land on the target length', () => {
  const base = snapshot();
  const result = mergeCodingRoomEventDelta(base, {
    workspaceRoot: '/workspace',
    events: [
      {
        ...base.events[0],
        payload: {
          content: 'lo',
          streamUpdateMode: CodingStreamUpdateMode.Append,
          [CodingStreamContentLengthField]: 6,
        },
      },
    ],
  });
  expect(result).toBe(base);
  expect(result.events[0].payload.content).toBe('old');
});
