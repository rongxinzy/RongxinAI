/**
 * Unit tests for CoworkStore – resilient metadata parsing.
 *
 * Verifies that corrupt JSON in the metadata column of cowork_messages does NOT
 * prevent a session from loading.  Valid/null metadata must still work correctly.
 *
 * Mocks the `electron` module so CoworkStore can be imported outside Electron.
 */
import { beforeEach, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron so the import of coworkStore.ts succeeds in Node
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

// ---------------------------------------------------------------------------
// Now import the class under test
// ---------------------------------------------------------------------------
import BetterSqlite3 from 'better-sqlite3';
import path from 'path';

import {
  AgentAvatarSvg,
  DefaultAgentAvatarIcon,
  encodeAgentAvatarIcon,
} from '../shared/agent/avatar';
import { COWORK_MESSAGE_PAGE_SIZE, CoworkSessionMode } from '../shared/cowork/constants';
import { CoworkSessionExpertSource } from '../shared/cowork/sessionExperts';
import { initializeCoworkArtifactIndexSchema } from './coworkArtifactIndex';
import { CoworkStore } from './coworkStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: BetterSqlite3.Database;
let store: CoworkStore;

/** Initialise a fresh in-memory database with the minimum schema. */
function setupDb(): void {
  db = new BetterSqlite3(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'work',
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model_override TEXT NOT NULL DEFAULT '',
      execution_mode TEXT NOT NULL DEFAULT 'local',
      active_skill_ids TEXT,
      workspace_id TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_session_experts (
      session_id TEXT NOT NULL,
      expert_id TEXT NOT NULL,
      package_id TEXT NOT NULL,
      expert_name TEXT NOT NULL,
      source TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      capability_policy TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, expert_id),
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  initializeCoworkArtifactIndexSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      triage_override TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_user_memories (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.5,
      is_explicit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );
  `);

  // CoworkStore only needs (db)
  store = new CoworkStore(db);
}

/** Insert a session row directly. */
function insertSession(id: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cowork_sessions (id, title, claude_session_id, status, mode, pinned, pin_order, cwd, system_prompt, execution_mode, active_skill_ids, workspace_id, agent_id, created_at, updated_at)
     VALUES (?, 'test', NULL, 'idle', 'work', 0, NULL, '/tmp', '', 'local', '[]', NULL, 'main', ?, ?)`,
  ).run(id, now, now);
}

/** Insert a message row directly, bypassing CoworkStore.addMessage. */
function insertMessage(
  id: string,
  sessionId: string,
  type: string,
  content: string,
  metadata: string | null,
  sequence: number,
  createdAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, type, content, metadata, createdAt, sequence);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDb();
});

test('getSession returns all messages when one has corrupt metadata', () => {
  const sid = 'sess-1';
  insertSession(sid);

  insertMessage('msg-valid', sid, 'user', 'hello', '{"key":"value"}', 1);
  insertMessage('msg-corrupt', sid, 'tool_use', 'do something', '{broken', 2);
  insertMessage('msg-null', sid, 'assistant', 'reply', null, 3);

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
  const sid = 'artifact-session';
  insertSession(sid);
  insertMessage(
    'artifact-message',
    sid,
    'assistant',
    '```artifact:html title="History preview"\n<h1>old</h1>\n```',
    null,
    1,
    1,
  );
  for (let sequence = 2; sequence <= 35; sequence += 1) {
    insertMessage(
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
  const sid = 'full-history-session';
  insertSession(sid);
  for (let sequence = 1; sequence <= 75; sequence += 1) {
    insertMessage(
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

test('sessions are grouped by workspace independently of their agent snapshot', () => {
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

test('workspace order changes only when the workspace is explicitly touched', () => {
  const first = store.ensureWorkspace('/tmp/workspace-a', 'Workspace A');
  const second = store.ensureWorkspace('/tmp/workspace-b', 'Workspace B');
  db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(100, first.id);
  db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(200, second.id);

  store.ensureWorkspace('/tmp/workspace-a', 'Renamed by selection');

  expect(store.getWorkspace(first.id)).toMatchObject({
    name: 'Workspace A',
    updatedAt: 100,
  });

  vi.useFakeTimers();
  vi.setSystemTime(300);
  store.touchWorkspace(first.id);
  vi.useRealTimers();

  expect(store.listWorkspaces().map(workspace => workspace.id)).toEqual([first.id, second.id]);
});

test('relocateWorkspace preserves session ownership under the renamed directory', () => {
  const beforePath = path.join(process.cwd(), 'workspace-before');
  const afterPath = path.join(process.cwd(), 'workspace-after');
  const session = store.createSession('rename me', beforePath);
  const oldWorkspace = store.getWorkspace(session.workspaceId)!;

  const renamedWorkspace = store.relocateWorkspace(oldWorkspace.id, afterPath, 'workspace-after');

  expect(renamedWorkspace).toMatchObject({ name: 'workspace-after', path: afterPath });
  expect(renamedWorkspace!.id).not.toBe(oldWorkspace.id);
  expect(store.getWorkspace(oldWorkspace.id)).toBeNull();
  expect(store.getSession(session.id)).toMatchObject({
    cwd: afterPath,
    workspaceId: renamedWorkspace!.id,
  });
  expect(store.countSessions(undefined, oldWorkspace.id)).toBe(0);
  expect(store.countSessions(undefined, renamedWorkspace!.id)).toBe(1);
});

test('listSessions filters by mode without mixing work and chat history', () => {
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

test('replaceConversationMessages preserves existing timestamps and uses gateway timestamps', () => {
  const sid = 'sess-replace-timestamps';
  insertSession(sid);

  insertMessage('msg-user', sid, 'user', 'old user', '{}', 1, 1000);
  insertMessage('msg-assistant', sid, 'assistant', 'old assistant', '{}', 2, 2000);

  store.replaceConversationMessages(sid, [
    { role: 'user', text: 'old user' },
    { role: 'assistant', text: 'old assistant' },
    { role: 'user', text: 'new user', timestamp: 3000 },
  ]);

  const session = store.getSession(sid);
  expect(
    session?.messages.map(message => ({
      type: message.type,
      content: message.content,
      timestamp: message.timestamp,
    })),
  ).toEqual([
    { type: 'user', content: 'old user', timestamp: 1000 },
    { type: 'assistant', content: 'old assistant', timestamp: 2000 },
    { type: 'user', content: 'new user', timestamp: 3000 },
  ]);
  expect(session?.updatedAt).toBe(3000);
});

test('getSession returns all messages when ALL have corrupt metadata', () => {
  const sid = 'sess-2';
  insertSession(sid);

  insertMessage('m1', sid, 'user', 'one', '{bad1', 1);
  insertMessage('m2', sid, 'assistant', 'two', '{{bad2', 2);
  insertMessage('m3', sid, 'tool_use', 'three', 'not json at all', 3);

  const session = store.getSession(sid);
  expect(session).not.toBeNull();
  expect(session!.messages).toHaveLength(3);

  for (const msg of session!.messages) {
    expect(msg.metadata).toBeUndefined();
    expect(msg.id).toBeTruthy();
    expect(msg.content).toBeTruthy();
  }
});

test('console.warn is called exactly once for single corrupt metadata row', () => {
  const sid = 'sess-3';
  insertSession(sid);

  insertMessage('msg-ok', sid, 'user', 'hi', '{"a":1}', 1);
  insertMessage('msg-bad', sid, 'tool_use', 'oops', '{broken', 2);
  insertMessage('msg-nil', sid, 'assistant', 'reply', null, 3);

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  store.getSession(sid);

  expect(warnSpy).toHaveBeenCalledTimes(1);

  const warnMessage = warnSpy.mock.calls[0][0] as string;
  expect(warnMessage).toContain('[CoworkStore]');
  expect(warnMessage).toContain('msg-bad');
  expect(warnMessage).toContain(sid);

  warnSpy.mockRestore();
});

test('no console.warn when all metadata is valid or null', () => {
  const sid = 'sess-4';
  insertSession(sid);

  insertMessage('m1', sid, 'user', 'hi', '{"ok":true}', 1);
  insertMessage('m2', sid, 'assistant', 'reply', null, 2);

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  store.getSession(sid);

  expect(warnSpy).not.toHaveBeenCalled();

  warnSpy.mockRestore();
});

test('updateMessage refreshes the session updated time', () => {
  const sid = 'sess-update-time';
  insertSession(sid);
  insertMessage('msg-edit', sid, 'assistant', 'draft', null, 1);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);
  db.prepare('UPDATE cowork_messages SET created_at = ? WHERE id = ?').run(1000, 'msg-edit');

  const beforeUpdate = Date.now();

  store.updateMessage(sid, 'msg-edit', { content: 'final' });

  const session = store.getSession(sid);
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
  expect(session?.messages[0]?.content).toBe('final');
});

test('upsertMessage preserves the caller message id and replaces streaming content', () => {
  const sid = 'sess-upsert-message';
  insertSession(sid);

  store.upsertMessage(sid, {
    id: 'chat-assistant-1',
    type: 'assistant',
    content: 'draft',
    timestamp: 1000,
    metadata: { isStreaming: true, isFinal: false },
  });
  store.upsertMessage(sid, {
    id: 'chat-assistant-1',
    type: 'assistant',
    content: 'final',
    timestamp: 1000,
    metadata: { isStreaming: false, isFinal: true },
  });

  expect(store.getSession(sid)?.messages).toEqual([
    expect.objectContaining({
      id: 'chat-assistant-1',
      content: 'final',
      metadata: { isStreaming: false, isFinal: true },
    }),
  ]);
});

test('updateSession refreshes the session updated time by default', () => {
  const sid = 'sess-update-session-time';
  insertSession(sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  const beforeUpdate = Date.now();

  store.updateSession(sid, { status: 'completed' });

  const session = store.getSession(sid);
  expect(session?.status).toBe('completed');
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
});

test('updateSession can patch model override without refreshing the session updated time', () => {
  const sid = 'sess-model-only';
  insertSession(sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  store.updateSession(
    sid,
    { modelOverride: 'deepseek/qwen3.6-plus' },
    { touchUpdatedAt: false },
  );

  const session = store.getSession(sid);
  expect(session?.modelOverride).toBe('deepseek/qwen3.6-plus');
  expect(session?.updatedAt).toBe(1000);
});

test('agent CRUD stores working directory independently', () => {
  const agent = store.createAgent({
    name: 'Docs Agent',
    model: 'openai/gpt-4o',
    workingDirectory: '/tmp/docs-project',
  });

  expect(agent.workingDirectory).toBe('/tmp/docs-project');

  const updated = store.updateAgent(agent.id, {
    workingDirectory: '/tmp/docs-next',
  });

  expect(updated?.workingDirectory).toBe('/tmp/docs-next');
  expect(store.getAgent(agent.id)?.workingDirectory).toBe('/tmp/docs-next');
});

test('agent CRUD normalizes legacy icons to the default svg avatar', () => {
  const designedIcon = encodeAgentAvatarIcon({
    svg: AgentAvatarSvg.Artboard,
  });

  const missingIconAgent = store.createAgent({ name: 'Missing Icon Agent' });
  const legacyIconAgent = store.createAgent({ name: 'Legacy Icon Agent', icon: 'legacy-icon' });
  const legacyDesignedIconAgent = store.createAgent({
    name: 'Legacy Designed Icon Agent',
    icon: 'agent-avatar:blue:code',
  });
  const designedIconAgent = store.createAgent({ name: 'Designed Icon Agent', icon: designedIcon });

  expect(missingIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyDesignedIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(designedIconAgent.icon).toBe(designedIcon);

  const updated = store.updateAgent(designedIconAgent.id, { icon: 'legacy-icon' });
  expect(updated?.icon).toBe(DefaultAgentAvatarIcon);
});

test('agent pinning stores first-pinned-first order', () => {
  const first = store.createAgent({ name: 'First Agent' });
  const second = store.createAgent({ name: 'Second Agent' });

  const pinnedFirst = store.updateAgent(first.id, { pinned: true });
  const pinnedSecond = store.updateAgent(second.id, { pinned: true });

  expect(pinnedFirst?.pinned).toBe(true);
  expect(pinnedSecond?.pinned).toBe(true);
  expect(pinnedFirst?.pinOrder).toBe(1);
  expect(pinnedSecond?.pinOrder).toBe(2);
});

test('agent unpinning clears pin order', () => {
  const agent = store.createAgent({ name: 'Pinned Agent' });
  store.updateAgent(agent.id, { pinned: true });

  const unpinned = store.updateAgent(agent.id, { pinned: false });

  expect(unpinned?.pinned).toBe(false);
  expect(unpinned?.pinOrder).toBeNull();
});

test('backfillEmptyAgentModels assigns the current default model to empty agents only', () => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, name, model, icon, skill_ids, enabled, is_default, source, preset_id, description, system_prompt, identity, created_at, updated_at)
     VALUES
     ('main', 'main', '', '', '[]', 1, 1, 'custom', '', '', '', '', ?, ?),
     ('writer', 'Writer', '', '', '[]', 1, 0, 'custom', '', '', '', '', ?, ?),
     ('stockexpert', 'Stock Expert', 'qwen3.5-plus', '', '[]', 1, 0, 'preset', 'stockexpert', '', '', '', ?, ?)`,
  ).run(now, now, now, now, now, now);

  expect(store.backfillEmptyAgentModels('deepseek-v3.2')).toBe(2);

  const rows = (
    db.prepare(`SELECT id, model FROM agents ORDER BY id`).all() as Array<{
      id: string;
      model: string;
    }>
  ).map(r => [r.id, r.model]);
  expect(rows).toEqual([
    ['main', 'deepseek-v3.2'],
    ['stockexpert', 'qwen3.5-plus'],
    ['writer', 'deepseek-v3.2'],
  ]);
});
