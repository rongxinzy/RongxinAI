import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkExecutionMode, CoworkMessageType } from '../shared/cowork/constants';
import { CoworkStore } from './coworkStore';
import { SqliteStore } from './sqliteStore';

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => os.tmpdir() },
}));

const fixtures: Array<{ directory: string; sqlite: SqliteStore }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    fixture.sqlite.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

async function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-session-read-'));
  const sqlite = await SqliteStore.create(directory);
  fixtures.push({ directory, sqlite });
  const store = new CoworkStore(sqlite.getDatabase());
  const session = store.createSession('metadata', directory, '', CoworkExecutionMode.Local);
  store.addMessage(session.id, {
    type: CoworkMessageType.Assistant,
    content: '```artifact:html title="Report"\n<h1>report</h1>\n```',
  });
  sqlite
    .getDatabase()
    .prepare('DELETE FROM cowork_artifact_index_state WHERE session_id=?')
    .run(session.id);
  return { sqlite, store, session };
}

test('metadata reads preserve the count without reading messages or rebuilding artifacts', async () => {
  const { sqlite, store, session } = await setup();
  const statements: string[] = [];
  const db = sqlite.getDatabase();
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    statements.push(sql);
    return prepare(sql);
  });

  const metadata = store.getSession(session.id, 0, { includeArtifacts: false });

  expect(metadata).toMatchObject({
    totalMessages: 1,
    messagesOffset: 1,
    messages: [],
    artifacts: [],
  });
  expect(
    statements.filter(sql => sql.includes('COUNT(*) as count FROM cowork_messages')),
  ).toHaveLength(1);
  expect(statements.some(sql => /SELECT\s+id,\s*type,\s*content/i.test(sql))).toBe(false);
  expect(statements.some(sql => sql.includes('cowork_artifact_index_state'))).toBe(false);
});

test('a subsequent transcript read still backfills and returns historical artifacts', async () => {
  const { store, session } = await setup();
  store.getSession(session.id, 0, { includeArtifacts: false });

  const transcript = store.getSession(session.id);

  expect(transcript?.messages).toHaveLength(1);
  expect(transcript?.artifacts).toEqual([
    expect.objectContaining({ title: 'Report', content: '<h1>report</h1>' }),
  ]);
});

test('zero-message reads retain artifact loading unless explicitly disabled', async () => {
  const { store, session } = await setup();
  const projection = store.getSession(session.id, 0);
  expect(projection?.messages).toEqual([]);
  expect(projection?.artifacts).toHaveLength(1);
});
