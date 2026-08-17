import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';

import type { ProjectIdentity } from '../memory/projectIdentity';
import { ConversationHistoryExcludedMessageType, ConversationHistoryRole } from './constants';
import { ConversationHistoryService } from './service';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

test('searches CJK conversation text only within the resolved current project', () => {
  const database = createDatabase();
  insertSession(database, 'session-a', 'Alpha session', '/workspace/alpha');
  insertSession(database, 'session-b', 'Beta session', '/workspace/beta');
  insertMessage(
    database,
    'message-a',
    'session-a',
    ConversationHistoryRole.User,
    '项目决定使用 SQLite 数据库。',
    null,
    1,
  );
  insertMessage(
    database,
    'thinking-a',
    'session-a',
    ConversationHistoryRole.Assistant,
    '项目数据库的隐藏思考。',
    JSON.stringify({ isThinking: true }),
    2,
  );
  insertMessage(
    database,
    'tool-a',
    'session-a',
    ConversationHistoryExcludedMessageType.ToolResult,
    '项目数据库工具输出。',
    null,
    3,
  );
  insertMessage(
    database,
    'message-b',
    'session-b',
    ConversationHistoryRole.User,
    '项目决定使用其他数据库。',
    null,
    4,
  );
  const service = new ConversationHistoryService(database, identityFor);

  const matches = service.search({
    workingDirectory: '/workspace/alpha',
    query: '我们之前讨论项目数据库',
  });

  expect(matches).toEqual([
    expect.objectContaining({
      messageId: 'message-a',
      sessionId: 'session-a',
      role: ConversationHistoryRole.User,
    }),
  ]);
});

test('returns bounded excerpts instead of full assistant messages', () => {
  const database = createDatabase();
  insertSession(database, 'session-a', 'Alpha session', '/workspace/alpha');
  insertMessage(
    database,
    'message-a',
    'session-a',
    ConversationHistoryRole.Assistant,
    `${'prefix '.repeat(100)}needle${' suffix'.repeat(100)}`,
    null,
    1,
  );
  const service = new ConversationHistoryService(database, identityFor);

  const [match] = service.search({ workingDirectory: '/workspace/alpha', query: 'needle' });

  expect(match.snippet).toContain('needle');
  expect(match.snippet.length).toBeLessThanOrEqual(606);
});

function createDatabase(): Database.Database {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL
    );
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER
    );
  `);
  return database;
}

function insertSession(database: Database.Database, id: string, title: string, cwd: string): void {
  database
    .prepare('INSERT INTO cowork_sessions (id, title, cwd) VALUES (?, ?, ?)')
    .run(id, title, cwd);
}

function insertMessage(
  database: Database.Database,
  id: string,
  sessionId: string,
  type: string,
  content: string,
  metadata: string | null,
  createdAt: number,
): void {
  database
    .prepare(
      `INSERT INTO cowork_messages
       (id, session_id, type, content, metadata, created_at, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, sessionId, type, content, metadata, createdAt, createdAt);
}

function identityFor(cwd: string): ProjectIdentity {
  const project = cwd.includes('alpha') ? 'alpha' : 'beta';
  return {
    id: `project-${project}`,
    displayName: project,
    root: cwd,
  };
}
