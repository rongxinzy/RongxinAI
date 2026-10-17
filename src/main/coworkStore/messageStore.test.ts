/**
 * Message persistence tests for CoworkStore.
 * Moved from src/main/coworkStore.test.ts (issue #1069); drives the public
 * CoworkStore facade so the split modules stay contract-compatible.
 */
import { beforeEach, expect, test, vi } from 'vitest';

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

test('replaceConversationMessages preserves existing timestamps and uses gateway timestamps', () => {
  const { db, store } = harness;
  const sid = 'sess-replace-timestamps';
  insertSessionRow(db, sid);

  insertMessageRow(db, 'msg-user', sid, 'user', 'old user', '{}', 1, 1000);
  insertMessageRow(db, 'msg-assistant', sid, 'assistant', 'old assistant', '{}', 2, 2000);

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

test('updateMessage refreshes the session updated time', () => {
  const { db, store } = harness;
  const sid = 'sess-update-time';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'msg-edit', sid, 'assistant', 'draft', null, 1);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);
  db.prepare('UPDATE cowork_messages SET created_at = ? WHERE id = ?').run(1000, 'msg-edit');

  const beforeUpdate = Date.now();

  store.updateMessage(sid, 'msg-edit', { content: 'final' });

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

  store.updateMessage(
    sid,
    'msg-edit-skipped',
    { content: 'streaming update' },
    { touchUpdatedAt: false },
  );

  const session = store.getSession(sid);
  expect(session?.updatedAt).toBe(1000);
  expect(session?.messages[0]?.content).toBe('streaming update');
});

test('upsertMessage preserves the caller message id and replaces streaming content', () => {
  const { db, store } = harness;
  const sid = 'sess-upsert-message';
  insertSessionRow(db, sid);

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

test('getSessionMessagesDesc returns newest-first pages in reverse chronological order', () => {
  const { db, store } = harness;
  const sid = 'sess-desc';
  insertSessionRow(db, sid);
  for (let i = 1; i <= 7; i += 1) {
    insertMessageRow(db, `m${i}`, sid, 'user', `msg-${i}`, null, i, 1000 + i);
  }

  expect(store.getSessionMessagesDesc(sid, 3, 0).map(m => m.id)).toEqual(['m7', 'm6', 'm5']);
  expect(store.getSessionMessagesDesc(sid, 3, 3).map(m => m.id)).toEqual(['m4', 'm3', 'm2']);
  expect(store.getSessionMessagesDesc(sid, 3, 6).map(m => m.id)).toEqual(['m1']);
  expect(store.getSessionMessagesDesc(sid, 3, 7)).toEqual([]);
});

test('getSessionMessagesDesc mirrors the ascending page order in reverse', () => {
  const { db, store } = harness;
  const sid = 'sess-desc-order';
  insertSessionRow(db, sid);
  for (let i = 1; i <= 10; i += 1) {
    insertMessageRow(
      db,
      `m${i}`,
      sid,
      i % 2 === 1 ? 'user' : 'assistant',
      `msg-${i}`,
      null,
      i,
      1000 + i,
    );
  }

  const ascending = store.getPagedSessionMessages(sid, 10, 0).map(m => m.id);
  const descending: string[] = [];
  let offset = 0;
  for (;;) {
    const page = store.getSessionMessagesDesc(sid, 4, offset);
    if (page.length === 0) break;
    descending.push(...page.map(m => m.id));
    offset += page.length;
    if (page.length < 4) break;
  }
  expect(descending).toEqual([...ascending].reverse());
});

test('getSessionMessageStats aggregates totals without materializing messages', () => {
  const { db, store } = harness;
  const sid = 'sess-stats';
  insertSessionRow(db, sid);
  insertMessageRow(db, 'a', sid, 'user', 'hello', '{"x":1}', 1);
  // Multibyte content: 2 characters, 6 UTF-8 bytes — stats must count bytes.
  insertMessageRow(db, 'b', sid, 'assistant', '你好', null, 2);

  const stats = store.getSessionMessageStats(sid);
  expect(stats.messageCount).toBe(2);
  expect(stats.contentBytes).toBe(5 + 6);
  expect(stats.metadataBytes).toBe(Buffer.byteLength('{"x":1}', 'utf8'));

  expect(store.getSessionMessageStats('missing-session')).toEqual({
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

  // Keep the SQL text identical to getPagedSessionMessages / getSessionMessagesDesc.
  const pagedAsc = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id, type, content, metadata, created_at, sequence
       FROM cowork_messages WHERE session_id = ?
       ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC LIMIT ? OFFSET ?`,
    )
    .all(sid, 50, 0) as Array<{ detail: string }>;
  const pagedDesc = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id, type, content, metadata, created_at, sequence
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

test('descending pages mirror ascending order across null sequences and timestamp ties', () => {
  const { db, store } = harness;
  const sid = 'sess-desc-ties';
  insertSessionRow(db, sid);
  const now = 1_700_000_000_000;
  const insertRaw = (id: string, createdAt: number, sequence: number | null): void => {
    db.prepare(
      `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
       VALUES (?, ?, 'user', ?, NULL, ?, ?)`,
    ).run(id, sid, id, createdAt, sequence);
  };
  // Gateway backfill can insert an older timestamp after newer rows; ties and
  // null sequences must not break the reverse-page mirror.
  insertRaw('tie-a', now, null);
  insertRaw('tie-b', now, null);
  insertRaw('seq-1', now - 10, 1);
  insertRaw('seq-2', now - 5, 2);
  insertRaw('backfill-older', now - 20, null);

  const ascending = store.getPagedSessionMessages(sid, 10, 0).map(m => m.id);
  const descending: string[] = [];
  let offset = 0;
  for (;;) {
    const page = store.getSessionMessagesDesc(sid, 2, offset);
    if (page.length === 0) break;
    descending.push(...page.map(m => m.id));
    offset += page.length;
    if (page.length < 2) break;
  }
  expect(descending).toEqual([...ascending].reverse());
});

test('addMessage assigns monotonic sequences and refreshes the session updated time', () => {
  const { store } = harness;
  const session = store.createSession('messages', '/tmp/message-store');

  const first = store.addMessage(session.id, { type: 'user', content: 'one' }, 1000);
  const second = store.addMessage(session.id, { type: 'assistant', content: 'two' }, 2000);

  expect(first).toMatchObject({ type: 'user', content: 'one', timestamp: 1000, sequence: 1 });
  expect(second).toMatchObject({ type: 'assistant', content: 'two', timestamp: 2000, sequence: 2 });
  expect(store.getSession(session.id)?.messages.map(m => m.id)).toEqual([first.id, second.id]);
  expect(store.getSession(session.id)?.updatedAt).toBe(2000);
  expect(store.countSessionMessages(session.id)).toBe(2);
});

test('insertMessageBeforeId shifts later sequences and lands before the target', () => {
  const { store } = harness;
  const sid = store.createSession('insert-before', '/tmp/insert-before').id;
  const user = store.addMessage(sid, { type: 'user', content: 'question' }, 1000);
  const assistant = store.addMessage(sid, { type: 'assistant', content: 'answer' }, 2000);
  const followUp = store.addMessage(sid, { type: 'assistant', content: 'follow up' }, 3000);

  const inserted = store.insertMessageBeforeId(sid, assistant.id, {
    type: 'user',
    content: 'channel message',
  });

  expect(inserted.sequence).toBe(assistant.sequence);
  expect(store.getPagedSessionMessages(sid, 10, 0).map(m => [m.id, m.sequence])).toEqual([
    [user.id, 1],
    [inserted.id, 2],
    [assistant.id, 3],
    [followUp.id, 4],
  ]);
});

test('insertMessageBeforeId falls back to an append when the target is missing', () => {
  const { store } = harness;
  const sid = store.createSession('insert-before-missing', '/tmp/insert-before-missing').id;
  const first = store.addMessage(sid, { type: 'user', content: 'question' }, 1000);

  const appended = store.insertMessageBeforeId(sid, 'missing-message-id', {
    type: 'user',
    content: 'appended',
  });

  expect(appended.sequence).toBe(2);
  expect(store.getPagedSessionMessages(sid, 10, 0).map(m => m.id)).toEqual([first.id, appended.id]);
});

test('deleteMessage removes only the targeted message', () => {
  const { store } = harness;
  const sid = store.createSession('delete-message', '/tmp/delete-message').id;
  const first = store.addMessage(sid, { type: 'user', content: 'one' }, 1000);
  const second = store.addMessage(sid, { type: 'assistant', content: 'two' }, 2000);

  expect(store.deleteMessage(sid, first.id)).toBe(true);
  expect(store.deleteMessage(sid, first.id)).toBe(false);
  expect(store.getPagedSessionMessages(sid, 10, 0).map(m => m.id)).toEqual([second.id]);
});
