import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

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
import { ArtifactLedger } from '../artifactLedger/artifactLedger';
import { initializeArtifactLedgerSchema } from '../artifactLedger/schema';
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
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

test('coalesces streamed tool call snapshots without rewriting an unchanged artifact', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  initializeArtifactLedgerSchema(db);
  const ledger = new ArtifactLedger(db);
  const recordFile = vi.spyOn(ledger, 'recordFile');
  const repository = new CodingRoomRepository(db, ledger);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Tool');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');
  db.exec(`CREATE TABLE artifact_updates (content TEXT);
    CREATE TRIGGER count_artifact_updates AFTER UPDATE ON artifact_ledger
    BEGIN INSERT INTO artifact_updates VALUES (NEW.content); END;`);

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.ToolCall, {
    toolCallId: 'call-1',
    toolName: 'write',
    toolInput: { path: 'report.md', content: 'initial report' },
    status: CodingToolCallStatus.Pending,
  });
  expect(recordFile).toHaveBeenCalledWith(
    lane.id,
    expect.objectContaining({ content: 'initial report' }),
  );
  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.ToolCall, {
    toolCallId: 'call-1',
    status: CodingToolCallStatus.Completed,
  });

  expect(repository.listEvents([lane.id])).toHaveLength(1);
  expect(repository.listEvents([lane.id])[0].payload).toMatchObject({
    toolCallId: 'call-1',
    toolName: 'write',
    status: CodingToolCallStatus.Completed,
  });
  expect(db.prepare('SELECT * FROM artifact_updates').all()).toEqual([]);

  repository.appendOrMergeStreamEvent(lane.id, CodingEventKind.ToolCall, {
    toolCallId: 'call-1',
    toolInput: { path: 'report.md', content: 'changed report' },
  });
  repository.flushPendingStreamWrites(lane.id);
  expect(recordFile).toHaveBeenLastCalledWith(
    lane.id,
    expect.objectContaining({ content: 'changed report' }),
  );
  expect(db.prepare('SELECT * FROM artifact_updates').all()).toEqual([
    { content: 'changed report' },
  ]);
});

test('resolves persisted Pi session ownership and excludes external lanes', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Direct lookup');
  const lane = repository.createLane(
    mission.id,
    CodingAgentProfileId.Builtin,
    '/workspace/project',
  );
  const external = repository.createLane(mission.id, 'agent', '/workspace/project');

  const reopened = new CodingRoomRepository(db);
  expect(reopened.getBuiltinLaneSession(lane.localSessionId)).toEqual({
    lane,
    roomId: room.id,
    workspaceRoot: room.workspaceRoot,
  });
  expect(repository.getRoomByLaneId(lane.id)).toEqual(
    expect.objectContaining({ id: room.id, workspaceRoot: '/workspace/project' }),
  );
  expect(reopened.hasBuiltinLaneSession(external.localSessionId)).toBe(false);
  expect(reopened.hasBuiltinLaneSession('missing-session')).toBe(false);
  expect(repository.getRoomByLaneId('missing-lane')).toBeNull();
  repository.deleteMission(room.id, mission.id);
  expect(reopened.hasBuiltinLaneSession(lane.localSessionId)).toBe(false);
});

test.each([
  [CodingEventKind.MessageDelta, CodingStreamUpdateMode.Append, 'lo'],
  [CodingEventKind.Reasoning, CodingStreamUpdateMode.Replace, 'Hello'],
] as const)('coalesces %s by message id and flushes one event to SQLite', (kind, mode, update) => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Memory coalesce');
  const lane = repository.createLane(mission.id, 'agent', '/workspace/project');

  const first = repository.appendOrMergeStreamEvent(lane.id, kind, {
    messageId: 'm1',
    content: 'Hel',
    streamUpdateMode: mode,
  });
  const second = repository.appendOrMergeStreamEvent(lane.id, kind, {
    messageId: 'm1',
    content: update,
    streamUpdateMode: mode,
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
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
      .get(repository.listEvents([lane.id])[0].id) as { payload_json: string };
    expect(JSON.parse(staleRow.payload_json).content).toBe('Hel');
    expect(repository.listEvents([lane.id])[0].payload.content).toBe('Hello');

    repository.flushPendingStreamWrites();
    const flushedRow = lockedDb
      .prepare('SELECT payload_json FROM coding_events WHERE id = ?')
      .get(repository.listEvents([lane.id])[0].id) as { payload_json: string };
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
  initializeArtifactLedgerSchema(db);
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
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Clarify implementation');
  const lane = repository.createLane(
    mission.id,
    CodingAgentProfileId.Builtin,
    '/workspace/project',
  );

  const elicitation = repository.createElicitation(lane.id, 'Which API should be used?');
  expect(() => repository.createElicitation(lane.id, 'Another question')).toThrow(
    'already pending',
  );
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
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Resume after restart');
  const lane = repository.createLane(
    mission.id,
    CodingAgentProfileId.Builtin,
    '/workspace/project',
  );
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
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const room = repository.getOrCreateRoom('/workspace/project');
  const mission = repository.createMission(room.id, 'Waiting lane');
  const lane = repository.createLane(
    mission.id,
    CodingAgentProfileId.Builtin,
    '/workspace/project',
  );
  repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingElicitation);
  repository.updateMissionStatus(mission.id, CodingMissionStatus.WaitingElicitation);

  const recovered = repository.recoverInterruptedLanes();

  expect(recovered.map(candidate => candidate.id)).toEqual([lane.id]);
  expect(repository.getBuiltinLaneSession(lane.localSessionId)?.lane.status).toBe(
    CodingLaneStatus.Idle,
  );
  expect(repository.listMissions(room.id)[0]?.status).toBe(CodingMissionStatus.NeedsReview);
});

test('recovery releases a writer lease persisted without a running lane', () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  initializeArtifactLedgerSchema(db);
  const repository = new CodingRoomRepository(db);
  const workspace = '/workspace/project';
  const room = repository.getOrCreateRoom(workspace);
  const mission = repository.createMission(room.id, 'Interrupted admission');
  const first = repository.createLane(mission.id, CodingAgentProfileId.Builtin, workspace);
  const next = repository.createLane(mission.id, CodingAgentProfileId.Builtin, workspace);
  repository.acquireWriterLease(room.id, workspace, first.id);
  expect(repository.getBuiltinLaneSession(first.localSessionId)?.lane.status).toBe(
    CodingLaneStatus.Idle,
  );

  const reopened = new CodingRoomRepository(db);
  expect(reopened.recoverInterruptedLanes()).toEqual([]);
  expect(reopened.getWriterLease(room.id, workspace)).toBeNull();
  reopened.acquireWriterLease(room.id, workspace, next.id);
  expect(reopened.getWriterLease(room.id, workspace)).toBe(next.id);
});
