import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { initializeCompanionTaskAdmissions } from '../companion/taskOwnership';
import { buildPiConversationHistoryTool } from './piTool';
import { ConversationHistoryService } from './service';
import { ConversationHistoryRole } from './constants';

const cleanups: Array<() => void> = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach(cleanup => cleanup()),
);
const workspace = '/workspace/shared';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  cleanups.push(() => {
    if (db.open) db.close();
  });
  db.exec(`CREATE TABLE IF NOT EXISTS cowork_sessions (id TEXT PRIMARY KEY, title TEXT, cwd TEXT);
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT, content TEXT,
      metadata TEXT, created_at INTEGER, sequence INTEGER);`);
  initializeCompanionTaskAdmissions(db);
  const service = new ConversationHistoryService(db, cwd => ({
    id: cwd,
    root: cwd,
    displayName: cwd,
  }));
  const add = (sessionId: string, owner: string | null, cwd = workspace) => {
    db.prepare('INSERT INTO cowork_sessions VALUES (?, ?, ?)').run(sessionId, sessionId, cwd);
    if (owner)
      db.prepare('INSERT INTO companion_task_admissions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        owner,
        sessionId,
        'fingerprint',
        sessionId,
        `task-${sessionId}`,
        `run-${sessionId}`,
        1,
      );
  };
  const message = (sessionId: string, content: string, time = 1) => {
    db.prepare('INSERT INTO cowork_messages VALUES (?, ?, ?, ?, NULL, ?, ?)').run(
      `${sessionId}-${time}`,
      sessionId,
      ConversationHistoryRole.User,
      content,
      time,
      time,
    );
  };
  const search = (sessionId?: string, query = 'shared-key', limit = 12) =>
    service
      .search({
        workingDirectory: workspace,
        sessionId,
        query,
        limit,
      })
      .map(match => match.sessionId);
  return { db, service, add, message, search };
}

test('companion tasks recall only their owner across tasks in the same project', () => {
  const { add, message, search } = fixture();
  add('a-current', 'pet-a');
  add('a-old', 'pet-a');
  add('b-current', 'pet-b');
  add('workbench', null);
  add('a-other-project', 'pet-a', '/workspace/other');
  for (const id of ['a-current', 'a-old', 'b-current', 'workbench', 'a-other-project'])
    message(id, `shared-key private details ${id}`);
  expect(search('a-current').sort()).toEqual(['a-current', 'a-old']);
  expect(search('b-current')).toEqual(['b-current']);
  expect(search('workbench')).toEqual(['workbench']);
  expect(search()).toEqual(['workbench']);
});

test('private matches are excluded before candidate limits and broad-query fallback', () => {
  const { add, message, search } = fixture();
  add('a', 'pet-a');
  add('b', 'pet-b');
  add('workbench', null);
  message('a', '项目决定使用 SQLite 数据库。');
  message('workbench', '项目决定使用 SQLite 数据库。');
  // More than the history candidate cap: post-query filtering would lose visible results.
  for (let i = 2; i < 180; i++) message('b', '项目决定使用 SQLite 数据库。', i);
  expect(search('a', '我们之前讨论项目数据库', 1)).toEqual(['a']);
  expect(search('workbench', '我们之前讨论项目数据库', 1)).toEqual(['workbench']);
});

test('tool calls cannot replace the host-bound session or companion identity', async () => {
  const { service, add, message } = fixture();
  add('a', 'pet-a');
  add('b', 'pet-b');
  message('a', 'shared-key owner-a');
  message('b', 'shared-key secret-b');
  const tool = buildPiConversationHistoryTool({
    service,
    workingDirectory: workspace,
    sessionId: 'a',
  }) as {
    parameters: { properties: Record<string, unknown> };
    execute: (
      id: string,
      args: Record<string, unknown>,
    ) => Promise<{ content: Array<{ text: string }> }>;
  };
  expect(tool.parameters.properties).not.toHaveProperty('sessionId');
  expect(tool.parameters.properties).not.toHaveProperty('petId');
  const result = await tool.execute('call-1', {
    query: 'shared-key',
    sessionId: 'b',
    petId: 'pet-b',
  });
  expect(result.content[0].text).toContain('owner-a');
  expect(result.content[0].text).not.toContain('secret-b');
});

test('ownership survives reopening the database and cannot be reassigned by a second admission', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'companion-history-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.sqlite');
  const first = fixture(filename);
  first.add('a', 'pet-a');
  first.add('b', 'pet-b');
  first.message('a', 'shared-key owner-a');
  first.message('b', 'shared-key secret-b');
  first.db.close();
  const reopened = fixture(filename);
  expect(reopened.search('a')).toEqual(['a']);
  expect(() =>
    reopened.db
      .prepare('INSERT INTO companion_task_admissions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('pet-b', 'other-request', 'fingerprint', 'a', 'other-task', 'other-run', 2),
  ).toThrow();
  expect(reopened.search('a')).toEqual(['a']);
});
