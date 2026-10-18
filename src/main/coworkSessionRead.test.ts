import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkExecutionMode, CoworkMessageType } from '../shared/cowork/constants';
import { CoworkStore } from './coworkStore';
import { SqliteStore } from './sqliteStore';
import { ArtifactLedger } from './artifactLedger/artifactLedger';

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
  const ledger = new ArtifactLedger(sqlite.getDatabase());
  const store = new CoworkStore(sqlite.getDatabase(), ledger);
  const session = store.createSession('metadata', directory, '', CoworkExecutionMode.Local);
  store.addMessage(session.id, {
    type: CoworkMessageType.Assistant,
    content: '```artifact:html title="Report"\n<h1>report</h1>\n```',
  });
  return { sqlite, store, session, ledger };
}

test('metadata reads preserve the count without reading messages or artifacts', async () => {
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
  expect(statements.some(sql => sql.includes('FROM artifact_ledger'))).toBe(false);
});

test('transcript reads return ledger artifacts recorded at event time', async () => {
  const { store, session, ledger } = await setup();
  ledger.recordFile(session.id, {
    filePath: '/tmp/report.html',
    id: 'artifact-tool-message-1',
    messageId: 'message-1',
    type: 'html',
    title: 'Report',
    content: '<h1>report</h1>',
    source: 'tool',
    role: 'intermediate',
    declared: false,
    createdAt: Date.now(),
  });
  store.getSession(session.id, 0, { includeArtifacts: false });

  const transcript = store.getSession(session.id);

  expect(transcript?.messages).toHaveLength(1);
  expect(transcript?.artifacts).toEqual([
    expect.objectContaining({ title: 'Report', content: '<h1>report</h1>' }),
  ]);
});

test('zero-message reads still load ledger artifacts unless disabled', async () => {
  const { store, session, ledger } = await setup();
  ledger.recordFile(session.id, {
    filePath: '/tmp/report.html',
    id: 'artifact-tool-message-1',
    messageId: 'message-1',
    type: 'html',
    title: 'report.html',
    content: '',
    source: 'tool',
    role: 'intermediate',
    declared: false,
    createdAt: Date.now(),
  });
  const projection = store.getSession(session.id, 0);
  expect(projection?.messages).toEqual([]);
  expect(projection?.artifacts).toHaveLength(1);
});
