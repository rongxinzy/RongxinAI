import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';

import {
  CodingAgentProfileId,
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
} from '../../shared/codingAgent';
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
