import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';

import { CodingEventKind, CodingEventWindowPageSize } from '../../shared/codingAgent';
import { initializeCodingAgentSchema } from './schema';
import { CodingRoomRepository } from './codingRoomRepository';
import { CodingEventWindowReader } from './codingEventWindowReader';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

test('loads only the recent event window and pages older events by sequence', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/window');
  const mission = repository.createMission(room.id, 'Window test');
  const lane = repository.createLane(mission.id, 'builtin-zhiyuan-coding', room.workspaceRoot);
  const total = CodingEventWindowPageSize + 5;
  for (let index = 0; index < total; index += 1) {
    repository.appendEvent(lane.id, CodingEventKind.Message, { content: String(index) });
  }

  const reader = new CodingEventWindowReader(db);
  const recent = reader.listRecent([lane.id]);
  expect(recent.events).toHaveLength(CodingEventWindowPageSize);
  expect(recent.events[0]?.sequence).toBe(6);
  expect(recent.events.at(-1)?.sequence).toBe(total);
  expect(recent.windows).toEqual([
    expect.objectContaining({
      laneId: lane.id,
      oldestSequence: 6,
      newestSequence: total,
      hasMore: true,
    }),
  ]);

  const older = reader.loadPage(lane.id, 6);
  expect(older.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  expect(older.hasMore).toBe(false);
  expect(older.nextCursor).toBeNull();
});
