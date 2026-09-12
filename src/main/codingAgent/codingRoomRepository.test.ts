import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import {
  CodingAgentProfileId,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
} from '../../shared/codingAgent';
import { initializeCodingAgentSchema } from './schema';
import { CodingRoomRepository } from './codingRoomRepository';

let db: Database.Database | undefined;
const tempDirectories: string[] = [];

afterEach(() => {
  db?.close();
  db = undefined;
  for (const directory of tempDirectories.splice(0)) {
    // Windows: a just-closed handle can briefly keep the directory busy.
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
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
  repository.updateLaneAvailableCommands(lane.id, [
    { name: 'mcp', description: 'List configured MCP tools.' },
    { name: '$project-skill', description: 'Run the project skill.' },
  ]);
  expect(repository.listLanes([mission.id])[0]).toEqual(
    expect.objectContaining({
      draft: 'Continue after review',
      scrollPosition: 42,
      availableCommands: [
        { name: 'mcp', description: 'List configured MCP tools.' },
        { name: '$project-skill', description: 'Run the project skill.' },
      ],
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
  repository.acquireWriterLease(room.id, '/workspace/project', first.id);
  expect(() => repository.acquireWriterLease(room.id, '/workspace/project', second.id)).toThrow(
    'writer lease',
  );
  repository.acquireWriterLease(room.id, '/workspace/other', second.id);
  repository.releaseWriterLease(room.id, '/workspace/project', first.id);
  repository.acquireWriterLease(room.id, '/workspace/project', second.id);
  expect(repository.createHandoff(mission.id, first.id, second.id, { summary: 'done' })).toEqual(
    expect.any(String),
  );
});

test('persists logical coding workspaces separately from source folders', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);

  const room = repository.createWorkspace(
    'Product app',
    ['/workspace/product', '/workspace/shared'],
    CodingAgentProfileId.Builtin,
  );

  expect(room).toMatchObject({
    name: 'Product app',
    workspaceRoot: '/workspace/product',
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  expect(repository.listWorkspaceSources(room.id)).toEqual([
    expect.objectContaining({ path: '/workspace/product', isPrimary: true }),
    expect.objectContaining({ path: '/workspace/shared', isPrimary: false }),
  ]);
  expect(repository.findWorkspaceIdBySource('/workspace/shared')).toBe(room.id);
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

test('coalesces streamed tool call snapshots with the same tool call ID', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Tool');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.ToolCall, {
    toolCallId: 'call-1',
    toolName: 'bash',
    toolInput: { command: 'pwd' },
    status: CodingToolCallStatus.Pending,
  });
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.ToolCall, {
    toolCallId: 'call-1',
    status: CodingToolCallStatus.Completed,
  });

  expect(repository.listEvents([lane.id])).toHaveLength(1);
  expect(repository.listEvents([lane.id])[0].payload).toMatchObject({
    toolCallId: 'call-1',
    toolName: 'bash',
    status: CodingToolCallStatus.Completed,
  });
});

test('loads a lane and its owning room directly by lane id', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Direct lookup');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  expect(repository.getLaneById(lane.id)).toEqual(expect.objectContaining({ id: lane.id }));
  expect(repository.getRoomByLaneId(lane.id)).toEqual(
    expect.objectContaining({ id: room.id, workspaceRoot: '/workspace/project' }),
  );
  expect(repository.getLaneById('missing-lane')).toBeNull();
  expect(repository.getRoomByLaneId('missing-lane')).toBeNull();
});

test('coalesces stream chunks in memory and flushes them to SQLite', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Memory coalesce');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  const first = repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'Hel',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });
  const second = repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'lo',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });

  // Both projected reads observe the merged content, under one event id.
  expect(second.id).toBe(first.id);
  expect(second.payload.content).toBe('Hello');
  expect(repository.listEvents([lane.id])).toHaveLength(1);
  expect(repository.listEvents([lane.id])[0].payload.content).toBe('Hello');

  // The buffered tail only reaches SQLite through the flush.
  const staleRow = db
    .prepare('SELECT payload_json FROM coding_events WHERE id = ?')
    .get(first.id) as { payload_json: string };
  expect(JSON.parse(staleRow.payload_json).content).toBe('Hel');
  repository.flushPendingStreamWrites();
  const flushedRow = db
    .prepare('SELECT payload_json FROM coding_events WHERE id = ?')
    .get(first.id) as { payload_json: string };
  expect(JSON.parse(flushedRow.payload_json).content).toBe('Hello');
});

test('takes over an existing stream row without duplicating it after a restart', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Restart takeover');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'Hel',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });
  repository.flushPendingStreamWrites();
  const resumed = repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'lo',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });

  expect(resumed.payload.content).toBe('Hello');
  expect(repository.listEvents([lane.id])).toHaveLength(1);
  repository.flushPendingStreamWrites();
  expect(repository.listEvents([lane.id])[0].payload.content).toBe('Hello');
});

test('deleting a lane drops its buffered stream writes', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Dropped writes');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'partial',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });
  repository.deleteLane(room.id, lane.id);
  repository.flushPendingStreamWrites();
  expect(
    db.prepare('SELECT COUNT(*) AS count FROM coding_events WHERE lane_id = ?').get(lane.id),
  ).toEqual({ count: 0 });
});

test('retains buffered stream writes when the flush hits a locked database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'coding-stream-flush-'));
  tempDirectories.push(directory);
  const dbPath = path.join(directory, 'events.sqlite');
  const lockedDb = new Database(dbPath, { timeout: 10 });
  db = lockedDb;
  initializeCodingAgentSchema(lockedDb);
  const repository = new CodingRoomRepository(lockedDb);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Locked flush');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'Hel',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'lo',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });

  const blocker = new Database(dbPath);
  try {
    blocker.exec('BEGIN EXCLUSIVE');
    // SQLITE_BUSY must not discard the buffered content.
    expect(() => repository.flushPendingStreamWrites()).not.toThrow();
    blocker.exec('ROLLBACK');

    const staleRow = lockedDb
      .prepare('SELECT payload_json FROM coding_events WHERE id = ?')
      .get(
        repository.listEvents([lane.id])[0].id,
      ) as { payload_json: string };
    expect(JSON.parse(staleRow.payload_json).content).toBe('Hel');
    expect(repository.listEvents([lane.id])[0].payload.content).toBe('Hello');

    repository.flushPendingStreamWrites();
    const flushedRow = lockedDb
      .prepare('SELECT payload_json FROM coding_events WHERE id = ?')
      .get(
        repository.listEvents([lane.id])[0].id,
      ) as { payload_json: string };
    expect(JSON.parse(flushedRow.payload_json).content).toBe('Hello');
  } finally {
    blocker.close();
  }
});

test('flushing against a closed database drops buffered writes without throwing', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'coding-stream-closed-'));
  tempDirectories.push(directory);
  db = new Database(path.join(directory, 'events.sqlite'));
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Closed flush');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.MessageDelta, {
    messageId: 'm1',
    content: 'partial',
    streamUpdateMode: CodingStreamUpdateMode.Append,
  });

  db.close();
  expect(() => repository.flushPendingStreamWrites()).not.toThrow();
});

test('persists one pending elicitation per lane and rejects duplicate responses', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Clarify implementation');
  const lane = repository.createLane(mission.id, CodingAgentProfileId.Builtin, '/workspace/project');

  const elicitation = repository.createElicitation(lane.id, 'Which API should be used?');
  expect(() => repository.createElicitation(lane.id, 'Another question')).toThrow('already pending');
  expect(repository.answerElicitation(elicitation.id, 'Use v2.')).toMatchObject({
    status: CodingElicitationStatus.Answered,
    answer: 'Use v2.',
  });
  expect(() => repository.answerElicitation(elicitation.id, 'Again')).toThrow('no longer awaiting');
  expect(repository.listElicitations([lane.id])).toHaveLength(1);
});

test('cancels the questions a previous application run left pending', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Resume after restart');
  const lane = repository.createLane(mission.id, CodingAgentProfileId.Builtin, '/workspace/project');
  const elicitation = repository.createElicitation(lane.id, 'Which endpoint should change?');

  const cancelled = repository.cancelPendingElicitations('The application restarted.');

  expect(cancelled).toEqual([
    expect.objectContaining({
      id: elicitation.id,
      status: CodingElicitationStatus.Cancelled,
      cancelReason: 'The application restarted.',
    }),
  ]);
  expect(repository.listElicitations([lane.id])).toEqual([
    expect.objectContaining({ id: elicitation.id, status: CodingElicitationStatus.Cancelled }),
  ]);
  expect(repository.cancelPendingElicitations('The application restarted.')).toEqual([]);
});

test('recovers the lanes and missions that were waiting for an answer', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Waiting lane');
  const lane = repository.createLane(mission.id, CodingAgentProfileId.Builtin, '/workspace/project');
  repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingElicitation);
  repository.updateMissionStatus(mission.id, CodingMissionStatus.WaitingElicitation);

  const recovered = repository.recoverInterruptedLanes();

  expect(recovered.map(candidate => candidate.id)).toEqual([lane.id]);
  expect(repository.getLaneById(lane.id)?.status).toBe(CodingLaneStatus.Idle);
  expect(repository.listMissions(room.id)[0]?.status).toBe(CodingMissionStatus.NeedsReview);
});
