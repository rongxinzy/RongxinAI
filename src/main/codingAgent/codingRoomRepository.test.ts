import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';

import { CodingEventKind, CodingStreamUpdateMode } from '../../shared/codingAgent';
import { initializeCodingAgentSchema } from './schema';
import { CodingRoomRepository } from './codingRoomRepository';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

test('persists independent mission lanes and append-only events', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Fix refresh flow');
  const lane = repository.createLane(mission.id, 'builtin-zhiyuan-coding', '/workspace/project');
  repository.setActive(room.id, mission.id, lane.id);
  const first = repository.appendEvent(lane.id, CodingEventKind.Message, {
    content: 'Investigate',
  });
  const second = repository.appendEvent(lane.id, CodingEventKind.TurnComplete, {});

  expect(repository.getOrCreateRoom('/workspace/project').activeLaneId).toBe(lane.id);
  expect(repository.listMissions(room.id)).toEqual([expect.objectContaining({ id: mission.id })]);
  expect(repository.listLanes([mission.id])).toEqual([expect.objectContaining({ id: lane.id })]);
  expect([first.sequence, second.sequence]).toEqual([1, 2]);
  expect(repository.listEvents([lane.id])).toHaveLength(2);
  repository.updateLaneViewState(lane.id, 'Continue after review', 42);
  expect(repository.listLanes([mission.id])[0]).toEqual(
    expect.objectContaining({
      draft: 'Continue after review',
      scrollPosition: 42,
    }),
  );
});

test('writer lease is mutually exclusive and handoffs are immutable records', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Review');
  const first = repository.createLane(mission.id, 'first', '/workspace/project');
  const second = repository.createLane(mission.id, 'second', '/workspace/project');
  repository.acquireWriterLease(room.id, first.id);
  expect(() => repository.acquireWriterLease(room.id, second.id)).toThrow('writer lease');
  repository.releaseWriterLease(room.id, first.id);
  repository.acquireWriterLease(room.id, second.id);
  expect(repository.createHandoff(mission.id, first.id, second.id, { summary: 'done' })).toEqual(
    expect.any(String),
  );
});

test('coalesces streamed chunks with the same message ID into one durable event', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Stream');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'message-1',
    content: 'First ',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'message-1',
    content: 'second',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });

  expect(repository.listEvents([lane.id])).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({ messageId: 'message-1', content: 'First second' }),
    }),
  ]);
});

test('replaces an in-process streaming snapshot instead of appending it', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Snapshot');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');
  for (const content of ['Hel', 'Hello', 'Hello world']) {
    repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
      messageId: 'pi-message',
      content,
      streamUpdateMode: CodingStreamUpdateMode.Replace,
    });
  }
  expect(repository.listEvents([lane.id])[0].payload.content).toBe('Hello world');
});
