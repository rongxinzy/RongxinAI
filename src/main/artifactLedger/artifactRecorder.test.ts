import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';

import { ArtifactLedger, normalizeArtifactKeyPath } from './artifactLedger';
import { initializeArtifactLedgerSchema } from './schema';
import { ArtifactRecorder } from './artifactRecorder';
import { setArtifactUpsertPublisher, type ArtifactUpsertEvent } from './publisher';
import { buildDeclareArtifactTool } from '../declareArtifact/tool';
import { takeWorkspaceSnapshot } from './workspaceSnapshot';
import { recordCodingLaneArtifact } from './codingLaneArtifacts';
import { CodingEventKind } from '../../shared/codingAgent';

const workspaces: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  setArtifactUpsertPublisher(() => {});
  for (const db of databases.splice(0)) db.close();
  for (const dir of workspaces.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function createWorkspace(): Promise<{
  root: string;
  ledger: ArtifactLedger;
  recorder: ArtifactRecorder;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-ws-'));
  workspaces.push(root);
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  initializeArtifactLedgerSchema(db);
  databases.push(db);
  const ledger = new ArtifactLedger(db);
  const recorder = new ArtifactRecorder({ sessionId: 'session-1', workspaceRoot: root, ledger });
  return { root, ledger, recorder };
}

function capturePublishes(): ArtifactUpsertEvent[] {
  const events: ArtifactUpsertEvent[] = [];
  setArtifactUpsertPublisher(event => events.push(event));
  return events;
}

// ── Scenario 1: write tool with a relative path ─────────────────────────────

test('write tool records a workspace file resolved against the workspace root', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  const events = capturePublishes();

  recorder.onRunStart('run-1');
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
  recorder.onToolStart('call-1', 'write', { file_path: 'reports/report.md', content: '# Title' });
  await fs.writeFile(path.join(root, 'reports/report.md'), '# Title', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: 'reports/report.md', content: '# Title' },
    isError: false,
    resultMessageId: 'm-result-1',
  });

  const artifacts = ledger.list('session-1');
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    type: 'markdown',
    filePath: path.join(root, 'reports/report.md'),
    fileName: 'report.md',
    content: '# Title',
    // Anchored to the persisted tool result message.
    messageId: 'm-result-1',
    toolCallId: 'call-1',
    runId: 'run-1',
    role: 'intermediate',
    declared: false,
  });
  expect(events).toHaveLength(1);
  expect(events[0].scopeId).toBe('session-1');
  recorder.dispose();
});

// ── Scenario 2: edit tool on an existing file ───────────────────────────────

test('edit tool records even though the old message-reparse heuristics missed it', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  const target = path.join(root, 'src', 'overview.md');
  await fs.writeFile(target, 'v1', 'utf8');

  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'edit', {
    file_path: 'src/overview.md',
    old_string: 'v1',
    new_string: 'v2',
  });
  await fs.writeFile(target, 'v2', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'edit',
    args: { file_path: 'src/overview.md' },
    isError: false,
    resultMessageId: 'm-result-1',
  });

  expect(ledger.list('session-1')).toHaveLength(1);
  expect(ledger.list('session-1')[0]).toMatchObject({ filePath: target, declared: false });
  recorder.dispose();
});

// ── Scenario 3: bash-produced binary via the workspace diff ────────────────

test('a bash-made document is caught by the debounced workspace diff', async () => {
  const { root, ledger, recorder } = await createWorkspace();

  recorder.onRunStart('run-1');
  // Wait for the run-start baseline so the diff can attribute the new file.
  await recorder.flushDiffs();
  await fs.writeFile(path.join(root, 'export.docx'), Buffer.from('binary'));
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'bash',
    args: { command: 'libreoffice --convert-to docx' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  await recorder.flushDiffs();
  recorder.onRunSettled('m-final');
  await recorder.flushDiffs();

  const artifacts = ledger.list('session-1');
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    type: 'document',
    filePath: path.join(root, 'export.docx'),
    content: '',
    // Attributed to the tool result that produced the file, not the final
    // answer: the debounced diff anchors there and the settle diff skips it.
    messageId: 'm-result-1',
    id: `artifact-diff-m-result-1-${normalizeArtifactKeyPath(path.join(root, 'export.docx').replace(/\\/g, '/'))}`,
  });
  recorder.dispose();
});

// ── Scenario 4: write + declare outside the workspace ───────────────────────

test('an outside-workspace write plus declaration is recorded and promoted', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-out-'));
  workspaces.push(outside);
  const { ledger, recorder } = await createWorkspace();
  const outsideFile = path.join(outside, 'deliverable.html');

  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'write', { file_path: outsideFile, content: '<h1>hi</h1>' });
  await fs.writeFile(outsideFile, '<h1>hi</h1>', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: outsideFile, content: '<h1>hi</h1>' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  recorder.onToolEnd({
    toolCallId: 'call-2',
    toolName: 'declare_artifact',
    args: { filePath: outsideFile, role: 'deliverable', title: 'Deliverable' },
    result: { details: { filePath: outsideFile, role: 'deliverable', title: 'Deliverable' } },
    isError: false,
    resultMessageId: 'm-result-2',
  });

  const artifacts = ledger.list('session-1');
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    filePath: outsideFile,
    declared: true,
    role: 'deliverable',
    title: 'Deliverable',
    content: '<h1>hi</h1>',
  });
  recorder.dispose();
});

// ── Scenario 5: failed write + failed declaration ───────────────────────────

test('a failed write records nothing and the failed declaration records nothing', async () => {
  const { root, ledger, recorder } = await createWorkspace();

  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'write', { file_path: 'missing/report.md', content: 'x' });
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: 'missing/report.md', content: 'x' },
    isError: true,
    result: 'write failed',
    resultMessageId: 'm-result-1',
  });
  recorder.onToolEnd({
    toolCallId: 'call-2',
    toolName: 'declare_artifact',
    args: { filePath: path.join(root, 'missing/report.md') },
    result: { details: { isError: true, error: 'file does not exist' } },
    isError: true,
    resultMessageId: 'm-result-2',
  });

  expect(ledger.list('session-1')).toEqual([]);
  recorder.dispose();
});

// ── Scenario 6: parallel write + declare awaits the pending write ──────────

test('a parallel declare waits for the in-flight write and then succeeds', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  const target = path.join(root, 'report.md');

  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'write', { file_path: 'report.md', content: 'done' });

  const tool = buildDeclareArtifactTool({
    fileExists: async filePath =>
      fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false),
    awaitPendingWrite: filePath => recorder.awaitPendingWrite(filePath),
    onDeclare: () => {},
  });
  const execute = tool.execute as (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ details: Record<string, unknown> }>;
  const pendingDeclare = execute('call-2', {
    filePath: target,
    role: 'deliverable',
    title: 'Parallel Report',
  });

  // While the write is still in flight, the recorder sees the declaration.
  recorder.onToolEnd({
    toolCallId: 'call-2',
    toolName: 'declare_artifact',
    args: { filePath: target, role: 'deliverable', title: 'Parallel Report' },
    result: {
      details: { filePath: target, role: 'deliverable', title: 'Parallel Report' },
    },
    isError: false,
    resultMessageId: 'm-result-2',
  });
  await fs.writeFile(target, 'done', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: 'report.md', content: 'done' },
    isError: false,
    resultMessageId: 'm-result-1',
  });

  const declareResult = await pendingDeclare;
  expect(declareResult.details.isError).toBeUndefined();
  expect(ledger.list('session-1')).toHaveLength(1);
  expect(ledger.list('session-1')[0]).toMatchObject({
    filePath: target,
    declared: true,
    role: 'deliverable',
    title: 'Parallel Report',
  });

  // A declaration for a never-written file fails instead of hanging.
  const failing = await execute('call-3', {
    filePath: path.join(root, 'nope.md'),
    role: 'deliverable',
  });
  expect(failing.details.isError).toBe(true);
  recorder.dispose();
});

// ── Scenario 7: ignored directories, cap overflow, no duplicates ───────────

test('diffs ignore .git and node_modules and never duplicate recorded files', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });

  recorder.onRunStart('run-1');
  await recorder.flushDiffs();

  await fs.writeFile(path.join(root, 'report.md'), 'v1', 'utf8');
  await fs.writeFile(path.join(root, '.git/tracked.md'), 'x', 'utf8');
  await fs.writeFile(path.join(root, 'node_modules/pkg/index.md'), 'x', 'utf8');

  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'bash',
    args: { command: 'touch' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  await recorder.flushDiffs();

  // The same file recorded through the write path later must not duplicate.
  recorder.onToolStart('call-2', 'write', { file_path: 'report.md', content: 'v2' });
  await fs.writeFile(path.join(root, 'report.md'), 'v2', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-2',
    toolName: 'write',
    args: { file_path: 'report.md', content: 'v2' },
    isError: false,
    resultMessageId: 'm-result-2',
  });
  recorder.onRunSettled('m-final');
  await recorder.flushDiffs();

  const artifacts = ledger.list('session-1');
  expect(artifacts.map(artifact => artifact.filePath)).toEqual([path.join(root, 'report.md')]);
  expect(artifacts[0]).toMatchObject({ content: 'v2', toolCallId: 'call-2' });
  recorder.dispose();
});

test('a truncated workspace snapshot disables diff detection with one warning', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recorder-cap-'));
  workspaces.push(root);
  for (let index = 0; index < 6; index += 1) {
    await fs.writeFile(path.join(root, `f${index}.md`), 'x', 'utf8');
  }
  const snapshot = await takeWorkspaceSnapshot(root, { maxFiles: 4 });
  expect(snapshot?.truncated).toBe(true);

  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  initializeArtifactLedgerSchema(db);
  databases.push(db);
  const ledger = new ArtifactLedger(db);
  const recorder = new ArtifactRecorder({
    sessionId: 'session-1',
    workspaceRoot: root,
    ledger,
    snapshotOptions: { maxFiles: 4 },
  });
  recorder.onRunStart('run-1');
  await recorder.flushDiffs();
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'bash',
    args: { command: 'x' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  await recorder.flushDiffs();
  recorder.onRunSettled('m-final');
  await recorder.flushDiffs();
  expect(ledger.list('session-1')).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
  recorder.dispose();
});

// ── Scenario 9: coding lane events → lane-scope rows ────────────────────────

test('coding lane events record under the lane scope', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE coding_agent_lanes (
      id TEXT PRIMARY KEY,
      execution_root TEXT,
      source_root TEXT
    );
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  initializeArtifactLedgerSchema(db);
  databases.push(db);
  db.prepare(
    `INSERT INTO coding_agent_lanes (id, execution_root, source_root) VALUES ('lane-1', '/repo/worktree', '/repo')`,
  ).run();

  capturePublishes();
  recordCodingLaneArtifactsForTest(db);

  const ledger = new ArtifactLedger(db);
  const artifacts = ledger.list('lane-1');
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    filePath: '/repo/worktree/out/report.html',
    content: '<h1>x</h1>',
    messageId: '',
    toolCallId: 'call-1',
    role: 'deliverable',
    type: 'html',
  });

  // Source-code files stay out of the artifact ledger.
  recordCodingLaneArtifact(db, 'lane-1', CodingEventKind.FileChange, {
    path: 'src/main.ts',
    type: 'diff',
    newText: 'export {}',
  });
  expect(ledger.list('lane-1')).toHaveLength(1);
});

function recordCodingLaneArtifactsForTest(db: Database.Database): void {
  recordCodingLaneArtifact(db, 'lane-1', CodingEventKind.FileChange, {
    path: 'out/report.html',
    type: 'diff',
    newText: '<h1>x</h1>',
    toolCallId: 'call-1',
  });
  // Unknown lanes never throw.
  recordCodingLaneArtifact(db, 'lane-missing', CodingEventKind.FileChange, {
    path: 'x.html',
    type: 'diff',
  });
}

// ── Recorder lifecycle ──────────────────────────────────────────────────────

test('dispose settles parked declarations as failed and ignores later events', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'write', { file_path: 'report.md', content: 'x' });

  const parked = recorder.awaitPendingWrite(path.join(root, 'report.md'));
  recorder.dispose();
  await expect(parked).resolves.toBe(false);

  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: 'report.md' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  expect(ledger.list('session-1')).toEqual([]);
});
