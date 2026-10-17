/**
 * Session CRUD and listing tests for CoworkStore.
 * Moved from src/main/coworkStore.test.ts (issue #1069); drives the public
 * CoworkStore facade so the split modules stay contract-compatible.
 */
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import {
  COWORK_MESSAGE_PAGE_SIZE,
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import { CoworkSessionExpertSource } from '../../shared/cowork/sessionExperts';
import {
  createCoworkStoreHarness,
  insertMessageRow,
  insertSessionRow,
  type CoworkStoreTestHarness,
} from './coworkStore.testHarness';

let harness: CoworkStoreTestHarness;

beforeEach(() => {
  harness = createCoworkStoreHarness();
});

test('sessions are grouped by workspace independently of their agent snapshot', () => {
  const { store } = harness;
  const first = store.createSession('first', '/tmp/workspace-a', '', 'local', [], 'agent-a');
  const second = store.createSession('second', '/tmp/workspace-a', '', 'local', [], 'agent-b');
  store.createSession('third', '/tmp/workspace-b', '', 'local', [], 'agent-a');

  expect(first.workspaceId).toBe(second.workspaceId);
  expect(first.agentId).not.toBe(second.agentId);
  expect(store.countSessions(undefined, first.workspaceId)).toBe(2);
  expect(
    store.listSessions(10, 0, undefined, first.workspaceId).map(session => session.id),
  ).toEqual(expect.arrayContaining([first.id, second.id]));
});

test('round-trips sessions using only the product session identity', () => {
  const { store } = harness;
  const session = store.createSession('contract', '/tmp/contract', '', CoworkExecutionMode.Local);
  store.updateSession(session.id, { systemPrompt: 'updated prompt' });
  const restored = store.getSession(session.id);
  expect(restored).toMatchObject({
    id: session.id,
    systemPrompt: 'updated prompt',
    executionMode: CoworkExecutionMode.Local,
  });
  expect(restored).not.toHaveProperty('claudeSessionId');
  const columns = harness.db.prepare('PRAGMA table_info(cowork_sessions)').all() as Array<{
    name: string;
  }>;
  expect(columns.map(column => column.name)).not.toContain('claude_session_id');
});

test('listSessions paginates independently by session source', () => {
  const { db, store } = harness;
  const workspace = store.ensureWorkspace('/tmp/workspace-source');
  const scheduled = store.createSession(
    'scheduled',
    workspace.path,
    '',
    'local',
    [],
    'main',
    '',
    CoworkSessionMode.Work,
    undefined,
    workspace.id,
    [],
    CoworkSessionSource.Scheduled,
  );
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1, scheduled.id);
  for (let index = 0; index < 8; index += 1) {
    const manual = store.createSession(`manual-${index}`, workspace.path);
    db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(index + 2, manual.id);
  }

  const scheduledSources = [CoworkSessionSource.Scheduled];
  const regularSources = [CoworkSessionSource.Manual, CoworkSessionSource.Im];

  expect(
    store
      .listSessions(6, 0, undefined, workspace.id, CoworkSessionMode.Work, scheduledSources)
      .map(session => session.id),
  ).toEqual([scheduled.id]);
  expect(
    store.countSessions(undefined, workspace.id, CoworkSessionMode.Work, scheduledSources),
  ).toBe(1);
  expect(store.countSessions(undefined, workspace.id, CoworkSessionMode.Work, regularSources)).toBe(
    8,
  );
});

test('listSessions filters by mode without mixing work and chat history', () => {
  const { store } = harness;
  const work = store.createSession('work', '/tmp/workspace-a');
  const chat = store.createSession(
    'chat',
    '/tmp/workspace-a',
    '',
    'local',
    [],
    'main',
    '',
    CoworkSessionMode.Chat,
  );
  const otherChat = store.createSession(
    'other chat',
    '/tmp/workspace-b',
    '',
    'local',
    [],
    'main',
    '',
    CoworkSessionMode.Chat,
  );

  expect(
    store.listSessions(10, 0, undefined, undefined, CoworkSessionMode.Chat).map(s => s.id),
  ).toEqual(expect.arrayContaining([chat.id, otherChat.id]));
  expect(store.countSessions(undefined, undefined, CoworkSessionMode.Chat)).toBe(2);
  expect(
    store.listSessions(10, 0, undefined, work.workspaceId, CoworkSessionMode.Work).map(s => s.id),
  ).toEqual([work.id]);
});

test('session expert snapshots persist independently from workspace and agent state', () => {
  const { store } = harness;
  const snapshot = {
    expertId: 'expert-a',
    packageId: 'package-a',
    expertName: 'Expert A',
    source: CoworkSessionExpertSource.Package,
    promptSnapshot: 'Use the expert instructions for this session.',
    skillIds: ['skill-a'],
    capabilityPolicy: {},
    contentHash: 'hash-a',
  };
  const session = store.createSession(
    'expert session',
    '/tmp/workspace-a',
    snapshot.promptSnapshot,
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    undefined,
    [snapshot],
  );

  const loaded = store.getSession(session.id);
  expect(loaded?.experts).toEqual([
    expect.objectContaining({
      expertId: 'expert-a',
      packageId: 'package-a',
      promptSnapshot: snapshot.promptSnapshot,
      skillIds: ['skill-a'],
      contentHash: 'hash-a',
    }),
  ]);

  store.replaceSessionExperts(session.id, []);
  expect(store.getSession(session.id)?.experts).toEqual([]);
});

test('updateSession refreshes the session updated time by default', () => {
  const { db, store } = harness;
  const sid = 'sess-update-session-time';
  insertSessionRow(db, sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  const beforeUpdate = Date.now();

  store.updateSession(sid, { status: 'completed' });

  const session = store.getSession(sid);
  expect(session?.status).toBe('completed');
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
});

test('updateSession can patch model override without refreshing the session updated time', () => {
  const { db, store } = harness;
  const sid = 'sess-model-only';
  insertSessionRow(db, sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  store.updateSession(sid, { modelOverride: 'deepseek/qwen3.6-plus' }, { touchUpdatedAt: false });

  const session = store.getSession(sid);
  expect(session?.modelOverride).toBe('deepseek/qwen3.6-plus');
  expect(session?.updatedAt).toBe(1000);
});

test('getSession returns all messages when one has corrupt metadata', () => {
  const { db, store } = harness;
  const sid = 'sess-1';
  insertSessionRow(db, sid);

  insertMessageRow(db, 'msg-valid', sid, 'user', 'hello', '{"key":"value"}', 1);
  insertMessageRow(db, 'msg-corrupt', sid, 'tool_use', 'do something', '{broken', 2);
  insertMessageRow(db, 'msg-null', sid, 'assistant', 'reply', null, 3);

  const session = store.getSession(sid);
  expect(session).not.toBeNull();
  expect(session!.messages).toHaveLength(3);

  // Valid metadata preserved
  const validMsg = session!.messages.find(m => m.id === 'msg-valid')!;
  expect(validMsg.metadata).toEqual({ key: 'value' });

  // Corrupt metadata discarded
  const corruptMsg = session!.messages.find(m => m.id === 'msg-corrupt')!;
  expect(corruptMsg.metadata).toBeUndefined();
  expect(corruptMsg.content).toBe('do something');
  expect(corruptMsg.type).toBe('tool_use');

  // Null metadata → undefined
  const nullMsg = session!.messages.find(m => m.id === 'msg-null')!;
  expect(nullMsg.metadata).toBeUndefined();
});

test('getSession lazily backfills artifacts from messages outside the loaded page', () => {
  const { db, store } = harness;
  const sid = 'artifact-session';
  insertSessionRow(db, sid);
  insertMessageRow(
    db,
    'artifact-message',
    sid,
    'assistant',
    '```artifact:html title="History preview"\n<h1>old</h1>\n```',
    null,
    1,
    1,
  );
  for (let sequence = 2; sequence <= 35; sequence += 1) {
    insertMessageRow(
      db,
      `message-${sequence}`,
      sid,
      'user',
      `message ${sequence}`,
      null,
      sequence,
      sequence,
    );
  }

  const session = store.getSession(sid);

  expect(session?.messagesOffset).toBe(5);
  expect(session?.messages.some(message => message.id === 'artifact-message')).toBe(false);
  expect(session?.artifacts).toEqual([
    expect.objectContaining({
      messageId: 'artifact-message',
      title: 'History preview',
      content: '<h1>old</h1>',
    }),
  ]);
});

test('getSession can return the complete transcript for a virtualized renderer', () => {
  const { db, store } = harness;
  const sid = 'full-history-session';
  insertSessionRow(db, sid);
  for (let sequence = 1; sequence <= 75; sequence += 1) {
    insertMessageRow(
      db,
      `message-${sequence}`,
      sid,
      sequence % 2 === 0 ? 'assistant' : 'user',
      `message ${sequence}`,
      null,
      sequence,
      sequence,
    );
  }

  const pagedSession = store.getSession(sid);
  const completeSession = store.getSession(sid, null);

  expect(pagedSession?.messages).toHaveLength(COWORK_MESSAGE_PAGE_SIZE);
  expect(pagedSession?.messagesOffset).toBe(45);
  expect(completeSession?.messages).toHaveLength(75);
  expect(completeSession?.messagesOffset).toBe(0);
  expect(completeSession?.totalMessages).toBe(75);
});

test('setSessionPinned assigns per-workspace pin order and re-pins at the tail', () => {
  const { store } = harness;
  const first = store.createSession('first', '/tmp/pin-workspace');
  const second = store.createSession('second', '/tmp/pin-workspace');
  const otherWorkspace = store.createSession('other', '/tmp/pin-other-workspace');

  expect(store.setSessionPinned(first.id, true)).toBe(1);
  expect(store.setSessionPinned(second.id, true)).toBe(2);
  // Pin order is scoped per workspace.
  expect(store.setSessionPinned(otherWorkspace.id, true)).toBe(1);

  expect(store.setSessionPinned(first.id, false)).toBeNull();
  expect(store.getSession(first.id)).toMatchObject({ pinned: false, pinOrder: null });

  expect(store.setSessionPinned(first.id, true)).toBe(3);
  expect(store.getSession(first.id)).toMatchObject({ pinned: true, pinOrder: 3 });

  expect(store.setSessionPinned('missing-session', true)).toBeNull();
});

test('deleteSessionsByAgentId removes and reports only that agent sessions', () => {
  const { store } = harness;
  const first = store.createSession('a1', '/tmp/agent-a', '', 'local', [], 'agent-a');
  const second = store.createSession('a2', '/tmp/agent-a', '', 'local', [], 'agent-a');
  store.createSession('b1', '/tmp/agent-b', '', 'local', [], 'agent-b');

  const removed = store.deleteSessionsByAgentId('agent-a').sort();

  expect(removed).toEqual([first.id, second.id].sort());
  expect(store.getSession(first.id)).toBeNull();
  expect(store.getSession(second.id)).toBeNull();
  expect(store.countSessions('agent-b')).toBe(1);
});

test('resetRunningSessions returns running sessions to idle', () => {
  const { db, store } = harness;
  const sid = store.createSession('running', '/tmp/reset-running').id;
  db.prepare("UPDATE cowork_sessions SET status = 'running' WHERE id = ?").run(sid);

  expect(store.resetRunningSessions()).toBe(1);
  expect(store.getSession(sid)?.status).toBe('idle');
  expect(store.resetRunningSessions()).toBe(0);
});

test('listRecentCwds returns unique normalized directories newest first', () => {
  const { db, store } = harness;
  const first = store.createSession('recent-a', '/tmp/recent-a');
  const second = store.createSession('recent-a-dup', '/tmp/recent-a/');
  const third = store.createSession('recent-b', '/tmp/recent-b');
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(300, first.id);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(200, second.id);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(100, third.id);

  const recent = store.listRecentCwds(2);

  // '/tmp/recent-a' and '/tmp/recent-a/' normalize to one entry.
  expect(recent).toEqual([first.cwd, third.cwd]);
  expect(store.listRecentCwds(0)).toEqual([]);
});
