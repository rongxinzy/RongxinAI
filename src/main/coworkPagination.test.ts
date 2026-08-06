/**
 * Pagination tests for cowork session/message queries.
 *
 * Uses an in-memory sql.js database (no Electron dependency) to verify that
 * the LIMIT/OFFSET SQL patterns introduced in coworkStore.ts behave correctly
 * with realistic seed data.
 */
import initSqlJs, { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers that mirror coworkStore.ts query logic
// ---------------------------------------------------------------------------

function getAll<T>(db: Database, sql: string, params: (string | number | null)[] = []): T[] {
  const result = db.exec(sql, params);
  if (!result[0]?.values) return [];
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });
    return row as T;
  });
}

function countRows(
  db: Database,
  table: string,
  where = '1=1',
  params: (string | number | null)[] = [],
): number {
  const result = db.exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`, params);
  return (result[0]?.values[0]?.[0] as number) || 0;
}

/** Mirror of listSessions(limit, offset) */
function listSessions(db: Database, limit: number, offset: number) {
  return getAll<{
    id: string;
    title: string;
    status: string;
    pinned: number;
    pin_order: number | null;
    updated_at: number;
  }>(
    db,
    `SELECT id, title, status, pinned, pin_order, updated_at
     FROM cowork_sessions
     ORDER BY pinned DESC,
       CASE WHEN pinned = 1 THEN COALESCE(pin_order, updated_at, created_at) END ASC,
       CASE WHEN pinned = 0 THEN updated_at END DESC,
       updated_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

/** Mirror of countSessions() */
function countSessions(db: Database): number {
  return countRows(db, 'cowork_sessions');
}

/** Mirror of countSessionMessages() */
function countSessionMessages(db: Database, sessionId: string): number {
  return countRows(db, 'cowork_messages', 'session_id = ?', [sessionId]);
}

/** Mirror of getPagedSessionMessages(sessionId, limit, offset) */
function getPagedSessionMessages(db: Database, sessionId: string, limit: number, offset: number) {
  return getAll<{ id: string; content: string; sequence: number | null }>(
    db,
    `SELECT id, content, sequence
     FROM (
       SELECT id, content, sequence, created_at, ROWID as rowid_
       FROM cowork_messages
       WHERE session_id = ?
       ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
       LIMIT ? OFFSET ?
     )
     ORDER BY COALESCE(sequence, created_at) ASC, rowid_ ASC`,
    [sessionId, limit, offset],
  );
}

function findUserMessageOffsetAtOrBefore(
  database: Database,
  sessionId: string,
  messageOffset: number,
  skip = 0,
): number | null {
  const rows = getAll<{ message_offset: number }>(
    database,
    `SELECT message_offset
     FROM (
       SELECT
         type,
         ROW_NUMBER() OVER (
           ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
         ) - 1 AS message_offset
       FROM cowork_messages
       WHERE session_id = ?
     )
     WHERE type = 'user' AND message_offset <= ?
     ORDER BY message_offset DESC
     LIMIT 1 OFFSET ?`,
    [sessionId, Math.max(0, messageOffset), Math.max(0, skip)],
  );
  return rows[0]?.message_offset ?? null;
}

function getTurnAwarePageBefore(
  database: Database,
  sessionId: string,
  endOffset: number,
  messageLimit: number,
) {
  const requestedOffset = Math.max(0, endOffset - messageLimit);
  const offset = findUserMessageOffsetAtOrBefore(database, sessionId, requestedOffset) ?? 0;
  return {
    messages: getPagedSessionMessages(database, sessionId, endOffset - offset, offset),
    offset,
  };
}

function getTurnAwareTailPage(database: Database, sessionId: string, messageLimit: number) {
  const totalMessages = countSessionMessages(database, sessionId);
  const requestedOffset = Math.max(0, totalMessages - messageLimit);
  const secondLatestUserOffset = findUserMessageOffsetAtOrBefore(
    database,
    sessionId,
    totalMessages - 1,
    1,
  );
  const boundaryCandidate = Math.min(requestedOffset, secondLatestUserOffset ?? 0);
  const offset = findUserMessageOffsetAtOrBefore(database, sessionId, boundaryCandidate) ?? 0;
  return {
    messages: getPagedSessionMessages(database, sessionId, totalMessages - offset, offset),
    offset,
  };
}

// ---------------------------------------------------------------------------
// Schema setup
// ---------------------------------------------------------------------------

let db: Database;

const SESSION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cowork_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    claude_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    pinned INTEGER NOT NULL DEFAULT 0,
    pin_order INTEGER,
    cwd TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    execution_mode TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const MESSAGE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cowork_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    sequence INTEGER
  );
`;

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(SESSION_SCHEMA);
  db.run(MESSAGE_SCHEMA);
  seedData(db);
});

afterAll(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Seed data: 120 sessions, one session with 200 messages
// ---------------------------------------------------------------------------

let seedSessionId = '';
let sessionWithManyMessagesId = '';

function seedData(database: Database): void {
  const now = Date.now();

  // Insert 120 sessions (some pinned)
  for (let i = 1; i <= 120; i++) {
    const id = `session-${String(i).padStart(4, '0')}`;
    const pinned = i <= 3 ? 1 : 0;
    database.run(
      `INSERT INTO cowork_sessions (id, title, status, pinned, pin_order, cwd, created_at, updated_at)
       VALUES (?, ?, 'idle', ?, ?, '/tmp', ?, ?)`,
      [
        id,
        `Session ${i}`,
        pinned,
        pinned ? i : null,
        now - (120 - i) * 1000,
        now - (120 - i) * 1000,
      ],
    );
  }
  seedSessionId = 'session-0001';

  // Insert one extra session with 200 messages
  sessionWithManyMessagesId = uuidv4();
  database.run(
    `INSERT INTO cowork_sessions (id, title, status, pinned, cwd, created_at, updated_at)
     VALUES (?, 'Long Session', 'idle', 0, '/tmp', ?, ?)`,
    [sessionWithManyMessagesId, now, now],
  );
  for (let i = 1; i <= 200; i++) {
    database.run(
      `INSERT INTO cowork_messages (id, session_id, type, content, created_at, sequence)
       VALUES (?, ?, 'user', ?, ?, ?)`,
      [uuidv4(), sessionWithManyMessagesId, `Message ${i}`, now + i, i],
    );
  }
}

// ---------------------------------------------------------------------------
// Session list pagination tests
// ---------------------------------------------------------------------------

test('countSessions returns 121 (120 regular + 1 long session)', () => {
  expect(countSessions(db)).toBe(121);
});

test('listSessions: first page returns exactly 50 items', () => {
  const page = listSessions(db, 50, 0);
  expect(page.length).toBe(50);
});

test('listSessions: second page returns exactly 50 items', () => {
  const page = listSessions(db, 50, 50);
  expect(page.length).toBe(50);
});

test('listSessions: third page returns remaining 21 items', () => {
  const page = listSessions(db, 50, 100);
  expect(page.length).toBe(21);
});

test('listSessions: page beyond total returns empty array', () => {
  const page = listSessions(db, 50, 200);
  expect(page.length).toBe(0);
});

test('listSessions: hasMore is correct for each page', () => {
  const total = countSessions(db);

  const page1 = listSessions(db, 50, 0);
  expect(0 + page1.length < total).toBe(true);

  const page2 = listSessions(db, 50, 50);
  expect(50 + page2.length < total).toBe(true);

  const page3 = listSessions(db, 50, 100);
  expect(100 + page3.length < total).toBe(false);
});

test('listSessions: no duplicate IDs across pages', () => {
  const total = countSessions(db);
  const pageSize = 50;
  const allIds: string[] = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = listSessions(db, pageSize, offset);
    allIds.push(...page.map(s => s.id));
  }
  expect(allIds.length).toBe(total);
  expect(new Set(allIds).size).toBe(total);
});

test('listSessions: pinned sessions appear at the front', () => {
  const first3 = listSessions(db, 3, 0);
  expect(first3.every(s => s.pinned === 1)).toBe(true);
});

test('listSessions: pinned sessions keep first-pinned-first order', () => {
  const first3 = listSessions(db, 3, 0);
  expect(first3.map(s => s.id)).toEqual(['session-0001', 'session-0002', 'session-0003']);
});

test('listSessions: all three pages together equal total count', () => {
  const p1 = listSessions(db, 50, 0);
  const p2 = listSessions(db, 50, 50);
  const p3 = listSessions(db, 50, 100);
  expect(p1.length + p2.length + p3.length).toBe(countSessions(db));
});

// ---------------------------------------------------------------------------
// Message pagination tests
// ---------------------------------------------------------------------------

test('countSessionMessages returns 200', () => {
  expect(countSessionMessages(db, sessionWithManyMessagesId)).toBe(200);
});

test('getPagedSessionMessages: first page returns 50 messages', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 0);
  expect(msgs.length).toBe(50);
});

test('getPagedSessionMessages: messages are ordered by sequence ASC', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 0);
  for (let i = 1; i < msgs.length; i++) {
    expect((msgs[i].sequence ?? 0) > (msgs[i - 1].sequence ?? 0)).toBe(true);
  }
});

test('getPagedSessionMessages: first page contains messages 1-50', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 0);
  expect(msgs[0].content).toBe('Message 1');
  expect(msgs[49].content).toBe('Message 50');
});

test('getPagedSessionMessages: second page contains messages 51-100', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 50);
  expect(msgs[0].content).toBe('Message 51');
  expect(msgs[49].content).toBe('Message 100');
});

test('getPagedSessionMessages: last page (offset=150) contains messages 151-200', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 150);
  expect(msgs.length).toBe(50);
  expect(msgs[0].content).toBe('Message 151');
  expect(msgs[49].content).toBe('Message 200');
});

test('getPagedSessionMessages: no duplicate IDs across all pages', () => {
  const total = countSessionMessages(db, sessionWithManyMessagesId);
  const allIds: string[] = [];
  for (let offset = 0; offset < total; offset += 50) {
    const page = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, offset);
    allIds.push(...page.map(m => m.id));
  }
  expect(allIds.length).toBe(total);
  expect(new Set(allIds).size).toBe(total);
});

test('getPagedSessionMessages: loading last 50 simulates initial session load', () => {
  const total = countSessionMessages(db, sessionWithManyMessagesId);
  const offset = Math.max(0, total - 50);
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, offset);
  expect(msgs.length).toBe(50);
  expect(msgs[0].content).toBe('Message 151');
  expect(msgs[49].content).toBe('Message 200');
});

test('getPagedSessionMessages: scroll-up load-more (offset 100->150 then 50->100)', () => {
  // Simulates: initial load at offset 150 (last 50), then two load-more calls
  const initial = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 150);
  expect(initial[0].content).toBe('Message 151');

  const prev1 = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 100);
  expect(prev1[0].content).toBe('Message 101');
  expect(prev1[49].content).toBe('Message 150');

  const prev2 = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 50);
  expect(prev2[0].content).toBe('Message 51');
  expect(prev2[49].content).toBe('Message 100');
});

test('getPagedSessionMessages: session with 0 messages returns empty array', () => {
  const msgs = getPagedSessionMessages(db, seedSessionId, 50, 0);
  expect(msgs.length).toBe(0);
});

test('getPagedSessionMessages: offset beyond total returns empty', () => {
  const msgs = getPagedSessionMessages(db, sessionWithManyMessagesId, 50, 999);
  expect(msgs.length).toBe(0);
});

test('turn-aware tail page includes the previous turn when the latest turn exceeds the limit', () => {
  const sessionId = uuidv4();
  const now = Date.now();
  db.run(
    `INSERT INTO cowork_sessions (id, title, status, pinned, cwd, created_at, updated_at)
     VALUES (?, 'Tool-heavy session', 'idle', 0, '/tmp', ?, ?)`,
    [sessionId, now, now],
  );
  db.run(
    `INSERT INTO cowork_messages (id, session_id, type, content, created_at, sequence)
     VALUES (?, ?, 'user', 'first turn', ?, 1),
            (?, ?, 'assistant', 'first answer', ?, 2),
            (?, ?, 'user', 'large final turn', ?, 3)`,
    [uuidv4(), sessionId, now + 1, uuidv4(), sessionId, now + 2, uuidv4(), sessionId, now + 3],
  );
  for (let sequence = 4; sequence <= 40; sequence += 1) {
    db.run(
      `INSERT INTO cowork_messages (id, session_id, type, content, created_at, sequence)
       VALUES (?, ?, 'tool_use', ?, ?, ?)`,
      [uuidv4(), sessionId, `tool call ${sequence}`, now + sequence, sequence],
    );
  }

  const page = getTurnAwareTailPage(db, sessionId, 30);

  expect(page.offset).toBe(0);
  expect(page.messages.filter(message => message.content.includes('turn'))).toHaveLength(2);
});

test('turn-aware history page expands backward without leaving a message gap', () => {
  const sessionId = uuidv4();
  const now = Date.now();
  db.run(
    `INSERT INTO cowork_sessions (id, title, status, pinned, cwd, created_at, updated_at)
     VALUES (?, 'Paged turns', 'idle', 0, '/tmp', ?, ?)`,
    [sessionId, now, now],
  );
  for (let turn = 0; turn < 4; turn += 1) {
    const turnStart = turn * 20 + 1;
    for (let index = 0; index < 20; index += 1) {
      const sequence = turnStart + index;
      db.run(
        `INSERT INTO cowork_messages (id, session_id, type, content, created_at, sequence)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          sessionId,
          index === 0 ? 'user' : 'tool_use',
          `message ${sequence}`,
          now + sequence,
          sequence,
        ],
      );
    }
  }

  const page = getTurnAwarePageBefore(db, sessionId, 60, 30);

  expect(page.offset).toBe(20);
  expect(page.messages).toHaveLength(40);
  expect(page.messages[0]?.content).toBe('message 21');
  expect(page.messages.at(-1)?.content).toBe('message 60');
});
