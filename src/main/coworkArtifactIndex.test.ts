import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';

import { CoworkArtifactRole, CoworkArtifactSource } from '../shared/cowork/artifacts';
import {
  COWORK_ARTIFACT_INDEX_VERSION,
  CoworkArtifactIndex,
  initializeCoworkArtifactIndexSchema,
} from './coworkArtifactIndex';

let db: BetterSqlite3.Database;
let index: CoworkArtifactIndex;

function insertMessage(
  id: string,
  sequence: number,
  type: string,
  content = '',
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO cowork_messages
       (id, session_id, type, content, metadata, created_at, sequence)
     VALUES (?, 'session-1', ?, ?, ?, ?, ?)`,
  ).run(id, type, content, metadata ? JSON.stringify(metadata) : null, sequence * 100, sequence);
}

beforeEach(() => {
  db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER
    );
    INSERT INTO cowork_sessions (id) VALUES ('session-1');
  `);
  initializeCoworkArtifactIndexSchema(db);
  index = new CoworkArtifactIndex(db);
});

describe('CoworkArtifactIndex', () => {
  test('lazily backfills old messages and persists code block content', () => {
    insertMessage(
      'assistant-1',
      1,
      'assistant',
      '```artifact:mermaid title="Flow"\ngraph TD\nA-->B\n```',
    );

    const artifacts = index.refreshSession('session-1');
    const state = db
      .prepare(
        `SELECT cursor_sequence, index_version
         FROM cowork_artifact_index_state WHERE session_id = 'session-1'`,
      )
      .get() as { cursor_sequence: number; index_version: number };

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      messageId: 'assistant-1',
      type: 'mermaid',
      content: 'graph TD\nA-->B',
    });
    expect(state).toEqual({
      cursor_sequence: 1,
      index_version: COWORK_ARTIFACT_INDEX_VERSION,
    });
  });

  test('advances the cursor through messages without artifacts', () => {
    insertMessage('user-1', 1, 'user', 'hello');
    index.refreshSession('session-1');
    insertMessage('assistant-1', 2, 'assistant', 'plain response');

    expect(index.refreshSession('session-1')).toEqual([]);
    const state = db
      .prepare(
        `SELECT cursor_sequence FROM cowork_artifact_index_state
         WHERE session_id = 'session-1'`,
      )
      .get() as { cursor_sequence: number };
    expect(state.cursor_sequence).toBe(2);
  });

  test('rebuilds stale running-session indexes with write outputs as intermediate', () => {
    insertMessage('write-1', 1, 'tool_use', '', {
      toolName: 'write',
      toolInput: { path: 'D:/output/_verify_tetris.js', content: 'runTests();' },
    });
    db.prepare(
      `INSERT INTO cowork_session_artifacts (
         session_id, artifact_key, id, message_id, type, title, content,
         file_name, file_path, source, role, declared, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'session-1',
      'path:d:/output/_verify_tetris.js',
      'legacy-artifact',
      'write-1',
      'code',
      '_verify_tetris.js',
      '',
      '_verify_tetris.js',
      'D:/output/_verify_tetris.js',
      CoworkArtifactSource.Tool,
      CoworkArtifactRole.Deliverable,
      0,
      100,
    );
    db.prepare(
      `INSERT INTO cowork_artifact_index_state
         (session_id, cursor_sequence, index_version)
       VALUES (?, ?, ?)`,
    ).run('session-1', 1, COWORK_ARTIFACT_INDEX_VERSION - 1);

    expect(index.listSession('session-1')).toEqual([
      expect.objectContaining({
        fileName: '_verify_tetris.js',
        role: CoworkArtifactRole.Intermediate,
        declared: false,
      }),
    ]);
  });

  test('keeps declaration metadata authoritative across incremental batches', () => {
    insertMessage('write-1', 1, 'tool_use', '', {
      toolName: 'Write',
      toolInput: { file_path: 'D:\\output\\report.html', content: '<h1>v1</h1>' },
    });
    expect(index.refreshSession('session-1')[0].title).toBe('report.html');

    insertMessage('declare-1', 2, 'tool_use', '', {
      toolName: 'declare_artifact',
      toolInput: {
        filePath: 'file:///D:/output/report.html',
        title: 'Declared title',
        role: CoworkArtifactRole.Intermediate,
      },
    });
    insertMessage('write-2', 3, 'tool_use', '', {
      toolName: 'write_file',
      toolInput: { path: 'D:/output/report.html', content: '<h1>v2</h1>' },
    });

    const artifacts = index.refreshSession('session-1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'artifact-declare-declare-1',
      title: 'Declared title',
      role: CoworkArtifactRole.Intermediate,
      declared: true,
      content: '',
    });
    expect(index.refreshSession('session-1')).toEqual(artifacts);
  });

  test('rebuilds after an indexed message is updated', () => {
    insertMessage('assistant-1', 1, 'assistant', 'plain response');
    expect(index.refreshSession('session-1')).toEqual([]);

    db.prepare('UPDATE cowork_messages SET content = ? WHERE id = ?').run(
      '```artifact:html title="Updated"\n<h1>updated</h1>\n```',
      'assistant-1',
    );

    expect(index.refreshSession('session-1')).toEqual([
      expect.objectContaining({
        title: 'Updated',
        content: '<h1>updated</h1>',
      }),
    ]);
  });
});
