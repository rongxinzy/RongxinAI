import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import Database from 'better-sqlite3';

import {
  artifactKeyForPath,
  ArtifactLedger,
  mergeLedgerRow,
  normalizeArtifactKeyPath,
  resolveArtifactInputPath,
} from './artifactLedger';
import {
  initializeArtifactLedgerSchema,
  migrateLegacyArtifactsToLedger,
  ARTIFACT_LEDGER_MIGRATION_KEY,
} from './schema';

interface ArtifactIndexRow {
  session_id: string;
  artifact_key: string;
  id: string;
  message_id: string;
  type: string;
  title: string;
  content: string;
  language: string | null;
  file_name: string | null;
  file_path: string | null;
  source: string;
  role: string;
  declared: number;
  created_at: number;
}

function createLegacyDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT NOT NULL
    );
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  db.exec(`
    CREATE TABLE cowork_session_artifacts (
      session_id TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      id TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      language TEXT,
      file_name TEXT,
      file_path TEXT,
      source TEXT NOT NULL,
      role TEXT NOT NULL,
      declared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, artifact_key),
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TRIGGER trg_cowork_artifact_index_message_update
    AFTER UPDATE ON cowork_messages
    BEGIN
      DELETE FROM cowork_session_artifacts;
    END;
    CREATE TRIGGER trg_cowork_artifact_index_message_delete
    AFTER DELETE ON cowork_messages
    BEGIN
      DELETE FROM cowork_session_artifacts;
    END;
  `);
  db.prepare(
    `INSERT INTO cowork_sessions (id, title, status, cwd) VALUES ('session-legacy', 't', 'idle', '/w')`,
  ).run();
  return db;
}

function insertLegacyArtifactRow(
  db: Database.Database,
  row: Partial<ArtifactIndexRow> & Pick<ArtifactIndexRow, 'artifact_key' | 'file_path'>,
): void {
  db.prepare(
    `INSERT INTO cowork_session_artifacts (
       session_id, artifact_key, id, message_id, type, title, content, language,
       file_name, file_path, source, role, declared, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'session-legacy',
    row.artifact_key,
    row.id ?? `id-${row.artifact_key}`,
    row.message_id ?? 'message-1',
    row.type ?? 'document',
    row.title ?? 'doc.docx',
    row.content ?? '',
    row.language ?? null,
    row.file_name ?? (row.file_path ? row.file_path.split('/').pop() : null),
    row.file_path,
    row.source ?? 'tool',
    row.role ?? 'intermediate',
    row.declared ?? 0,
    row.created_at ?? 1000,
  );
}

test('artifact keys normalize separators and only lowercase on windows', () => {
  const key = normalizeArtifactKeyPath('/work/Reports/File One.PDF');
  expect(artifactKeyForPath('/work/Reports/File One.PDF')).toBe(`path:${key}`);
  expect(key.startsWith('/work/reports/file')).toBe(process.platform === 'win32');
  expect(normalizeArtifactKeyPath('C:\\Docs\\A.md')).toBe(
    process.platform === 'win32' ? 'c:/docs/a.md' : 'C:/Docs/A.md',
  );
});

test('resolveArtifactInputPath accepts file urls, tildes, and relative paths', () => {
  const root = process.platform === 'win32' ? 'C:\\work' : '/work';
  expect(resolveArtifactInputPath('notes/report.md', root)).toBe(
    path.resolve(root, 'notes/report.md'),
  );
  expect(resolveArtifactInputPath('file:///work/reports/a%20b.md', '/other')).toBe(
    '/work/reports/a b.md',
  );
  expect(resolveArtifactInputPath('~/x.md', root)).toBe(
    path.resolve(path.join(os.homedir(), 'x.md')),
  );
  expect(resolveArtifactInputPath('@notes/report.md', root)).toBe(
    path.resolve(root, 'notes/report.md'),
  );
});

test('recordFile merges declarations over observations without losing content', () => {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  initializeArtifactLedgerSchema(db);
  const ledger = new ArtifactLedger(db);

  const first = ledger.recordFile('session-1', {
    filePath: '/work/report.docx',
    id: 'artifact-tool-m1',
    messageId: 'm1',
    toolCallId: 'call-1',
    runId: 'run-1',
    type: 'document',
    title: 'report.docx',
    content: '',
    source: 'tool',
    role: 'intermediate',
    declared: false,
    createdAt: 1000,
  });
  expect(first).toMatchObject({ id: 'artifact-tool-m1', declared: false, role: 'intermediate' });

  const declared = ledger.recordFile('session-1', {
    filePath: '/work/report.docx',
    id: 'artifact-declare-call-9',
    messageId: 'm2',
    toolCallId: 'call-9',
    runId: 'run-1',
    type: 'document',
    title: 'Final Report',
    content: '',
    source: 'tool',
    role: 'deliverable',
    declared: true,
    createdAt: 2000,
  });
  expect(declared).toMatchObject({
    id: 'artifact-declare-call-9',
    title: 'Final Report',
    role: 'deliverable',
    declared: true,
    toolCallId: 'call-9',
  });

  const listed = ledger.list('session-1');
  expect(listed).toHaveLength(1);
  expect(listed[0].filePath).toBe('/work/report.docx');

  // A later observation must not demote the declared row: declared metadata
  // (declared flag, role, title, type) and created_at are kept, while the
  // anchor moves to the latest touching event.
  const observed = ledger.recordFile('session-1', {
    filePath: '/work/report.docx',
    id: 'artifact-tool-m3',
    messageId: 'm3',
    type: 'text',
    title: 'report.docx',
    content: 'content never overwrites',
    source: 'tool',
    role: 'intermediate',
    declared: false,
    createdAt: 3000,
  });
  expect(observed).toMatchObject({
    id: 'artifact-tool-m3',
    messageId: 'm3',
    title: 'Final Report',
    type: 'document',
    role: 'deliverable',
    declared: true,
    createdAt: 1000,
  });
  // Later observed content refreshes the row; the declared identity stays.
  expect(observed?.content).toBe('content never overwrites');
  // Stable ordering: re-recording never moves the row in created_at order.
  expect(ledger.list('session-1')[0].createdAt).toBe(1000);
});

test('mergeLedgerRow is the single merge rule: anchor moves, declared metadata and created_at stay', () => {
  const merged = mergeLedgerRow(
    {
      id: 'observed',
      messageId: 'm1',
      type: 'document',
      title: 'old.docx',
      content: 'original content',
      source: 'tool',
      role: 'deliverable',
      declared: true,
      createdAt: 1,
      filePath: '/old',
      fileName: 'old.docx',
      toolCallId: null,
      runId: null,
    },
    {
      id: 'observed-2',
      messageId: 'm2',
      type: 'text',
      title: 'new.docx',
      content: '',
      source: 'tool',
      role: 'intermediate',
      declared: false,
      createdAt: 2,
      filePath: '/new',
      fileName: 'new.docx',
      toolCallId: 'call-2',
      runId: 'run-2',
    },
  );
  expect(merged).toMatchObject({
    // Anchor moves to the latest touching event.
    id: 'observed-2',
    messageId: 'm2',
    toolCallId: 'call-2',
    runId: 'run-2',
    // Declared metadata survives a plain file event.
    title: 'old.docx',
    type: 'document',
    role: 'deliverable',
    declared: true,
    // File identity refreshes; created_at stays at first sighting.
    filePath: '/new',
    fileName: 'new.docx',
    createdAt: 1,
    // Empty observed content never erases stored content.
    content: 'original content',
  });
});

test('annotate creates missing rows and keeps existing titles when none is given', () => {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  initializeArtifactLedgerSchema(db);
  const ledger = new ArtifactLedger(db);

  // Declaration before any observation creates the row, titled by file name.
  const created = ledger.annotate('session-1', {
    filePath: '/work/final.html',
    role: 'deliverable',
    kind: 'html',
    messageId: 'm1',
    toolCallId: 'call-1',
  });
  expect(created).toMatchObject({
    id: 'artifact-declare-call-1',
    type: 'html',
    title: 'final.html',
    role: 'deliverable',
    declared: true,
  });

  // A titled declaration renames; an untitled one keeps the existing title.
  ledger.annotate('session-1', {
    filePath: '/work/final.html',
    role: 'deliverable',
    title: 'Final Report',
    messageId: 'm2',
    toolCallId: 'call-2',
  });
  const untitled = ledger.annotate('session-1', {
    filePath: '/work/final.html',
    role: 'deliverable',
    messageId: 'm3',
    toolCallId: 'call-3',
  });
  expect(untitled).toMatchObject({
    title: 'Final Report',
    messageId: 'm3',
    toolCallId: 'call-3',
  });
  expect(ledger.list('session-1')).toHaveLength(1);
  db.close();
});

test('deleting a cowork session cascades ledger rows through the trigger', () => {
  const db = createLegacyDatabase();
  initializeArtifactLedgerSchema(db);
  db.exec(
    `INSERT INTO cowork_sessions (id, title, status, cwd) VALUES ('session-live', 't', 'idle', '/w')`,
  );
  const ledger = new ArtifactLedger(db);
  ledger.recordFile('session-live', {
    filePath: '/w/a.md',
    id: 'a',
    messageId: 'm',
    type: 'markdown',
    title: 'a.md',
    source: 'tool',
    role: 'intermediate',
    createdAt: 1,
  });
  expect(ledger.list('session-live')).toHaveLength(1);

  db.prepare(`DELETE FROM cowork_sessions WHERE id = 'session-live'`).run();
  expect(ledger.list('session-live')).toEqual([]);
});

test('legacy artifact rows migrate once and later runs never re-copy', () => {
  const db = createLegacyDatabase();
  insertLegacyArtifactRow(db, { artifact_key: 'path:/w/legacy.docx', file_path: '/w/legacy.docx' });
  insertLegacyArtifactRow(db, { artifact_key: 'codeblock:1', file_path: null });
  initializeArtifactLedgerSchema(db);

  migrateLegacyArtifactsToLedger(db, normalizeArtifactKeyPath);
  const ledger = new ArtifactLedger(db);
  const migrated = ledger.list('session-legacy');
  expect(migrated).toHaveLength(1);
  expect(migrated[0]).toMatchObject({
    filePath: '/w/legacy.docx',
    id: 'id-path:/w/legacy.docx',
    createdAt: 1000,
  });

  // Adopted rows keep their original created_at; updated_at is set at copy time.
  const row = db
    .prepare(`SELECT created_at, updated_at FROM artifact_ledger WHERE scope_id = 'session-legacy'`)
    .get() as { created_at: number; updated_at: number };
  expect(row.updated_at).toBe(1000);

  // A new artifact recorded after migration stays ahead of any re-copy.
  ledger.recordFile('session-legacy', {
    filePath: '/w/legacy.docx',
    id: 'newer-id',
    messageId: 'm2',
    type: 'document',
    title: 'renamed.docx',
    source: 'tool',
    role: 'deliverable',
    declared: true,
    createdAt: 5000,
  });
  db.prepare(`DELETE FROM kv WHERE key = ?`).run(ARTIFACT_LEDGER_MIGRATION_KEY);
  migrateLegacyArtifactsToLedger(db, normalizeArtifactKeyPath);
  expect(ledger.list('session-legacy')[0]).toMatchObject({ id: 'newer-id', declared: true });

  // The guard marker itself prevents copies without manual deletion.
  const guard = db
    .prepare('SELECT value FROM kv WHERE key = ?')
    .get(ARTIFACT_LEDGER_MIGRATION_KEY) as { value: string } | undefined;
  expect(guard?.value).toBeTruthy();

  db.close();
});

test('legacy index triggers are dropped and ledger scope deletion is explicit', () => {
  const db = createLegacyDatabase();
  initializeArtifactLedgerSchema(db);
  const triggers = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
    .all() as Array<{ name: string }>;
  expect(triggers.map(trigger => trigger.name)).toEqual(['trg_artifact_ledger_session_delete']);

  const ledger = new ArtifactLedger(db);
  ledger.recordFile('lane-1', {
    filePath: '/repo/out.html',
    id: 'l',
    messageId: '',
    type: 'html',
    title: 'out.html',
    source: 'tool',
    role: 'deliverable',
    createdAt: 1,
  });
  expect(ledger.list('lane-1')).toHaveLength(1);
  ledger.deleteScope('lane-1');
  expect(ledger.list('lane-1')).toEqual([]);
  db.close();
});
