/**
 * Message persistence tests for CoworkStore.
 * Moved from src/main/coworkStore.test.ts (issue #1069); drives the public
 * CoworkStore facade so the split modules stay contract-compatible.
 */
import { beforeEach, expect, test, vi } from 'vitest';
import { CoworkMessageType, CoworkSessionStatus } from '../../shared/cowork/constants';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

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

test('commits an interruption message and its idle status as one write', () => {
  const { db, store } = harness;
  const sessionId = 'stopped-session';
  insertSessionRow(db, sessionId);
  store.updateSession(sessionId, { status: CoworkSessionStatus.Error });
  db.exec(`CREATE TRIGGER fail_idle_update BEFORE UPDATE OF status ON cowork_sessions
    WHEN NEW.status = '${CoworkSessionStatus.Idle}'
    BEGIN SELECT RAISE(ABORT, 'Idle write failed'); END`);
  const append = () =>
    store.messages.addMessage(
      sessionId,
      { type: CoworkMessageType.System, content: 'Stopped.' },
      123,
      CoworkSessionStatus.Idle,
    );
  expect(append).toThrow('Idle write failed');
  expect(store.getSession(sessionId)).toMatchObject({
    status: CoworkSessionStatus.Error,
    messages: [],
  });
  db.exec('DROP TRIGGER fail_idle_update');
  const message = append();
  expect(store.getSession(sessionId)).toMatchObject({
    status: CoworkSessionStatus.Idle,
    updatedAt: 123,
    messages: [message],
  });
});

test('getSession returns all messages when ALL have corrupt metadata', () => {
  const { db, store } = harness;
  const sid = 'sess-2';
  insertSessionRow(db, sid);

  insertMessageRow(db, 'm1', sid, 'user', 'one', '{bad1', 1);
  insertMessageRow(db, 'm2', sid, 'assistant', 'two', '{{bad2', 2);
  insertMessageRow(db, 'm3', sid, 'tool_use', 'three', 'not json at all', 3);

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
  const { db, store } = harness;
  const sid = 'sess-3';
  insertSessionRow(db, sid);

  insertMessageRow(db, 'msg-ok', sid, 'user', 'hi', '{"a":1}', 1);
  insertMessageRow(db, 'msg-bad', sid, 'tool_use', 'oops', '{broken', 2);
  insertMessageRow(db, 'msg-nil', sid, 'assistant', 'reply', null, 3);

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
  const { db, store } = harness;
  const sid = 'sess-4';
  insertSessionRow(db, sid);

  insertMessageRow(db, 'm1', sid, 'user', 'hi', '{"ok":true}', 1);
  insertMessageRow(db, 'm2', sid, 'assistant', 'reply', null, 2);

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  store.getSession(sid);

  expect(warnSpy).not.toHaveBeenCalled();

  warnSpy.mockRestore();
});

test('updateMessage refreshes the session updated time', () => {
  const { db, store } = harness;
  const sid = 'sess-update-time';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'msg-edit', sid, 'assistant', 'draft', null, 1);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);
  db.prepare('UPDATE cowork_messages SET created_at = ? WHERE id = ?').run(1000, 'msg-edit');

  const beforeUpdate = Date.now();

  store.messages.updateMessage(sid, 'msg-edit', { content: 'final' });

  const session = store.getSession(sid);
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
  expect(session?.messages[0]?.content).toBe('final');
});

test('updateMessage can skip refreshing the session updated time', () => {
  const { db, store } = harness;
  const sid = 'sess-update-time-skipped';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'msg-edit-skipped', sid, 'assistant', 'draft', null, 1);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  store.messages.updateMessage(
    sid,
    'msg-edit-skipped',
    { content: 'streaming update' },
    { touchUpdatedAt: false },
  );

  const session = store.getSession(sid);
  expect(session?.updatedAt).toBe(1000);
  expect(session?.messages[0]?.content).toBe('streaming update');
});

test('finds unmatched tool calls in transcript order across the newest user page', () => {
  const { db, store } = harness;
  const id = 'open-tools';
  insertSessionRow(db, id);
  const tool = (sequence: number, type: 'tool_use' | 'tool_result', toolUseId: string) =>
    insertMessageRow(db, `m-${sequence}`, id, type, '', JSON.stringify({ toolUseId }), sequence);
  tool(1, 'tool_use', 'too-old');
  tool(8, 'tool_use', 'orphan');
  insertMessageRow(db, 'latest-user', id, 'user', 'prompt', '{bad json', 18);
  tool(19, 'tool_use', 'finished');
  tool(20, 'tool_use', 'pending');
  tool(21, 'tool_result', 'finished');
  tool(22, 'tool_use', 'orphan');
  insertMessageRow(db, 'bad-tool', id, 'tool_use', '', '{bad json', 23);
  insertMessageRow(db, 'bad-id', id, 'tool_use', '', '{"toolUseId":{"nested":true}}', 24);
  for (let index = 25; index <= 405; ++index) {
    insertMessageRow(db, `m-${index}`, id, 'assistant', 'response', null, index);
  }
  // Fill the sparse early range so the boundary page begins at row six.
  for (const sequence of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
    insertMessageRow(db, `m-${sequence}`, id, 'assistant', '', null, sequence);
  }
  expect(store.messages.listOpenToolUseIds(id)).toEqual(['orphan', 'pending']);
  expect(store.messages.listOpenToolUseIds('other')).toEqual([]);
});

test('getSessionMessageStats aggregates totals without materializing messages', () => {
  const { db, store } = harness;
  const sid = 'sess-stats';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'a', sid, 'user', 'hello', '{"x":1}', 1);
  // Multibyte content: 2 characters, 6 UTF-8 bytes — stats must count bytes.
  insertMessageRow(db, 'b', sid, 'assistant', '你好', null, 2);

  const stats = store.messages.getSessionMessageStats(sid);
  expect(stats.messageCount).toBe(2);
  expect(stats.contentBytes).toBe(5 + 6);
  expect(stats.metadataBytes).toBe(Buffer.byteLength('{"x":1}', 'utf8'));

  expect(store.messages.getSessionMessageStats('missing-session')).toEqual({
    messageCount: 0,
    contentBytes: 0,
    metadataBytes: 0,
  });
});

// Same DDL as sqliteStore initSchema; the minimal test schema omits indexes.
const CREATE_SESSION_ORDER_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_cowork_messages_session_order
  ON cowork_messages(session_id, COALESCE(sequence, created_at), created_at);
`;

test('session message pages use the ordering index, not a temp b-tree sort', () => {
  const { db } = harness;
  const sid = 'sess-plan';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'p1', sid, 'user', 'one', null, 1);
  db.exec(CREATE_SESSION_ORDER_INDEX);

  // Keep the SQL text identical to getPagedSessionMessages.
  const pagedAsc = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id, type, content, metadata, created_at, sequence
       FROM cowork_messages WHERE session_id = ?
       ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC LIMIT ? OFFSET ?`,
    )
    .all(sid, 50, 0) as Array<{ detail: string }>;
  const pagedDesc = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT type
       FROM cowork_messages WHERE session_id = ?
       ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC LIMIT ? OFFSET ?`,
    )
    .all(sid, 50, 0) as Array<{ detail: string }>;

  for (const plan of [pagedAsc, pagedDesc]) {
    const detail = plan.map(row => row.detail).join('\n');
    expect(detail).not.toContain('TEMP B-TREE');
    expect(detail).toContain('idx_cowork_messages_session_order');
  }
});

test('addMessage assigns monotonic sequences and refreshes the session updated time', () => {
  const { store } = harness;
  const session = store.createSession('messages', '/tmp/message-store');

  const first = store.messages.addMessage(session.id, { type: 'user', content: 'one' }, 1000);
  const second = store.messages.addMessage(session.id, { type: 'assistant', content: 'two' }, 2000);

  expect(first).toMatchObject({ type: 'user', content: 'one', timestamp: 1000, sequence: 1 });
  expect(second).toMatchObject({ type: 'assistant', content: 'two', timestamp: 2000, sequence: 2 });
  expect(store.getSession(session.id)?.messages.map(m => m.id)).toEqual([first.id, second.id]);
  expect(store.getSession(session.id)?.updatedAt).toBe(2000);
  expect(store.messages.countSessionMessages(session.id)).toBe(2);
});

test('message writes roll back if their session timestamp cannot be committed', () => {
  const { db, store } = harness;
  const session = store.createSession('messages', '/tmp/message-store');
  const id = session.id;
  const first = store.messages.addMessage(id, { type: 'assistant', content: 'original' }, 1000);
  db.exec(`
    CREATE TEMP TRIGGER reject_session_touch BEFORE UPDATE OF updated_at ON cowork_sessions
    BEGIN SELECT RAISE(ABORT, 'session timestamp write rejected'); END;
  `);

  expect(() =>
    store.messages.addMessage(id, { type: 'user', content: 'new message' }, 2000),
  ).toThrow('session timestamp write rejected');
  expect(() => store.messages.updateMessage(id, first.id, { content: 'replacement' })).toThrow(
    'session timestamp write rejected',
  );
  expect(store.getSession(id)?.messages).toEqual([first]);
  expect(store.getSession(id)?.updatedAt).toBe(1000);

  store.messages.updateMessage(id, first.id, { content: 'checkpoint' }, { touchUpdatedAt: false });
  expect(store.messages.getMessage(id, first.id)?.content).toBe('checkpoint');
  expect(store.getSession(id)?.updatedAt).toBe(1000);

  db.exec('DROP TRIGGER reject_session_touch');
  const second = store.messages.addMessage(id, { type: 'user', content: 'new message' }, 2000);
  expect(second.sequence).toBe(2);
  expect(store.getSession(id)?.updatedAt).toBe(2000);
});

test('commits the final answer marker and idle status together after a failed turn', () => {
  const { db, store } = harness;
  const { id } = store.createSession('recovered turn', '/tmp/message-store');
  store.updateSession(id, { status: CoworkSessionStatus.Error });
  const answer = store.messages.addMessage(id, {
    type: CoworkMessageType.Assistant,
    content: 'done',
  });
  const settle = () =>
    store.messages.updateMessage(
      id,
      answer.id,
      { metadata: { isFinalAnswer: true } },
      { sessionStatus: CoworkSessionStatus.Idle },
    );
  db.exec(`CREATE TEMP TRIGGER reject_idle BEFORE UPDATE OF status ON cowork_sessions
    WHEN NEW.status = '${CoworkSessionStatus.Idle}'
    BEGIN SELECT RAISE(ABORT, 'idle status rejected'); END`);
  expect(settle).toThrow('idle status rejected');
  expect(store.messages.getMessage(id, answer.id)).toEqual(answer);
  expect(store.getSession(id)?.status).toBe(CoworkSessionStatus.Error);

  db.exec('DROP TRIGGER reject_idle');
  expect(settle()).toBe(true);
  expect(store.messages.getMessage(id, answer.id)?.metadata).toEqual({ isFinalAnswer: true });
  expect(store.getSession(id)?.status).toBe(CoworkSessionStatus.Idle);
});

test('deleteMessage removes only the targeted message', () => {
  const { store } = harness;
  const sid = store.createSession('delete-message', '/tmp/delete-message').id;
  const first = store.messages.addMessage(sid, { type: 'user', content: 'one' }, 1000);
  const second = store.messages.addMessage(sid, { type: 'assistant', content: 'two' }, 2000);

  expect(store.messages.deleteMessage(sid, first.id)).toBe(true);
  expect(store.messages.deleteMessage(sid, first.id)).toBe(false);
  expect(store.messages.getPagedSessionMessages(sid, 10, 0).map(m => m.id)).toEqual([second.id]);
});

test('getMessage returns a row only under its own session id', () => {
  const { store } = harness;
  const sidA = store.createSession('get-message-a', '/tmp/get-message-a').id;
  const sidB = store.createSession('get-message-b', '/tmp/get-message-b').id;
  const message = store.messages.addMessage(
    sidA,
    { type: 'assistant', content: 'checkpoint body' },
    1000,
  );

  expect(store.messages.getMessage(sidA, message.id)?.content).toBe('checkpoint body');
  // The same message id asked under another session must not leak across rows.
  expect(store.messages.getMessage(sidB, message.id)).toBeNull();
  expect(store.messages.getMessage(sidA, 'no-such-message')).toBeNull();
  expect(store.messages.getMessage('no-such-session', message.id)).toBeNull();
});
