import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';

import { ArtifactLedger, normalizeArtifactKeyPath } from './artifactLedger';
import { initializeArtifactLedgerSchema } from './schema';
import { ArtifactRecorder } from './artifactRecorder';
import { setArtifactUpsertPublisher, type ArtifactUpsertEvent } from './publisher';
import * as workspaceSnapshots from './workspaceSnapshot';
import { recordCodingLaneArtifact } from './codingLaneArtifacts';
import { CodingAgentProfileId, CodingEventKind } from '../../shared/codingAgent';

const { takeWorkspaceSnapshot } = workspaceSnapshots;
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

test('retains explicit writes and withholds overlapping workspace diffs from both runs', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  const child = path.join(root, 'child');
  await fs.mkdir(child);
  const peer = new ArtifactRecorder({ sessionId: 'peer', workspaceRoot: child, ledger });
  recorder.onRunStart('run-1');
  peer.onRunStart('peer-1');
  await Promise.all([recorder.flushDiffs(), peer.flushDiffs()]);

  const known = path.join(child, 'known.md');
  await fs.writeFile(known, 'Explicit write');
  await fs.writeFile(path.join(child, 'ambiguous.md'), 'Unowned change');
  const own = path.join(root, 'exclusive.md');
  await fs.writeFile(own, 'Outside the shared directory');
  peer.onToolEnd({
    toolCallId: 'write-known',
    toolName: 'write',
    args: { path: known, content: 'Explicit write' },
    isError: false,
    resultMessageId: 'peer-write',
  });

  // A peer settling first does not make its earlier writes attributable to the other run.
  expect(await peer.onRunSettled('peer-answer')).toBe(1);
  expect(await recorder.onRunSettled('answer')).toBe(1);
  expect(ledger.list('session-1').map(artifact => artifact.filePath)).toEqual([own]);
  expect(ledger.list('peer').map(artifact => artifact.filePath)).toEqual([known]);

  peer.onRunStart('peer-2');
  await peer.flushDiffs();
  const solo = path.join(child, 'solo.md');
  await fs.writeFile(solo, 'Isolated scan');
  expect(await peer.onRunSettled('solo-answer')).toBe(1);
  expect(ledger.list('peer').map(artifact => artifact.filePath)).toEqual([known, solo]);
  recorder.dispose();
  peer.dispose();
});

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
    role: 'deliverable',
    declared: true,
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
  expect(ledger.list('session-1')[0]).toMatchObject({
    filePath: target,
    role: 'deliverable',
    declared: true,
  });
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
    role: 'deliverable',
    declared: true,
    // Attributed to the tool result that produced the file, not the final
    // answer: the debounced diff anchors there and the settle diff skips it.
    messageId: 'm-result-1',
    id: `artifact-diff-m-result-1-${normalizeArtifactKeyPath(path.join(root, 'export.docx').replace(/\\/g, '/'))}`,
  });
  recorder.dispose();
});

// ── Scenario 4: write outside the workspace ────────────────────────────────

test('an outside-workspace write is recorded', async () => {
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

  const artifacts = ledger.list('session-1');
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    filePath: outsideFile,
    role: 'deliverable',
    declared: true,
    title: 'deliverable.html',
    content: '<h1>hi</h1>',
  });
  recorder.dispose();
});

test('keeps helper code files intermediate while promoting powershell-produced html deliverables', async () => {
  const { root, ledger, recorder } = await createWorkspace();

  recorder.onRunStart('run-1');
  await recorder.flushDiffs();

  recorder.onToolStart('call-py', 'write', { file_path: 'build_report.py', content: 'print(1)' });
  await fs.writeFile(path.join(root, 'build_report.py'), 'print(1)', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-py',
    toolName: 'write',
    args: { file_path: 'build_report.py', content: 'print(1)' },
    isError: false,
    resultMessageId: 'm-py',
  });

  await fs.writeFile(path.join(root, 'dashboard.html'), '<h1>ok</h1>', 'utf8');
  recorder.onToolEnd({
    toolCallId: 'call-ps',
    toolName: 'powershell',
    args: { command: 'python build_report.py' },
    isError: false,
    resultMessageId: 'm-ps',
  });
  await recorder.flushDiffs();

  const artifacts = ledger.list('session-1');
  expect(artifacts).toHaveLength(2);
  expect(artifacts.find(item => item.fileName === 'build_report.py')).toMatchObject({
    role: 'intermediate',
    declared: false,
  });
  expect(artifacts.find(item => item.fileName === 'dashboard.html')).toMatchObject({
    role: 'deliverable',
    declared: true,
  });
  recorder.dispose();
});

// ── Scenario 5: failed write ───────────────────────────────────────────────

test('a failed write records nothing', async () => {
  const { ledger, recorder } = await createWorkspace();

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

  expect(ledger.list('session-1')).toEqual([]);
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
      profile_id TEXT NOT NULL,
      execution_root TEXT,
      source_root TEXT
    );
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  initializeArtifactLedgerSchema(db);
  databases.push(db);
  db.prepare(
    `INSERT INTO coding_agent_lanes (id, profile_id, execution_root, source_root) VALUES
      ('lane-1', 'external', '/repo/worktree', '/repo'),
      ('builtin-lane', ?, '/repo/worktree', '/repo')`,
  ).run(CodingAgentProfileId.Builtin);

  capturePublishes();
  const ledger = new ArtifactLedger(db);
  recordCodingLaneArtifactsForTest(db, ledger);
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
  recordCodingLaneArtifact(db, ledger, 'lane-1', CodingEventKind.FileChange, {
    path: 'src/main.ts',
    type: 'diff',
    newText: 'export {}',
  });
  expect(ledger.list('lane-1')).toHaveLength(1);

  recordCodingLaneArtifact(db, ledger, 'builtin-lane', CodingEventKind.FileChange, {
    path: 'out/report.html',
    type: 'diff',
    newText: '<h1>x</h1>',
  });
  expect(ledger.list('builtin-lane')).toHaveLength(0);
});

test('coding lane rows carry the workbench run of the lane assignment', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE coding_agent_lanes (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, execution_root TEXT, source_root TEXT
    );
    CREATE TABLE coding_assignments (
      id TEXT PRIMARY KEY, lane_id TEXT, workbench_run_id TEXT, created_at INTEGER
    );
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  initializeArtifactLedgerSchema(db);
  databases.push(db);
  db.prepare(
    `INSERT INTO coding_agent_lanes (id, profile_id, execution_root, source_root)
      VALUES ('lane-1', 'external', '/repo', '/repo')`,
  ).run();
  db.prepare(
    `INSERT INTO coding_assignments (id, lane_id, workbench_run_id, created_at) VALUES
      ('old', 'lane-1', 'run-old', 1), ('new', 'lane-1', 'run-new', 2)`,
  ).run();

  const ledger = new ArtifactLedger(db);
  recordCodingLaneArtifact(db, ledger, 'lane-1', CodingEventKind.FileChange, {
    path: 'out/report.html',
    type: 'diff',
    newText: '<h1>x</h1>',
  });

  expect(ledger.list('lane-1')[0].runId).toBe('run-new');
});

function recordCodingLaneArtifactsForTest(db: Database.Database, ledger: ArtifactLedger): void {
  recordCodingLaneArtifact(db, ledger, 'lane-1', CodingEventKind.FileChange, {
    path: 'out/report.html',
    type: 'diff',
    newText: '<h1>x</h1>',
    toolCallId: 'call-1',
  });
  // Unknown lanes never throw.
  recordCodingLaneArtifact(db, ledger, 'lane-missing', CodingEventKind.FileChange, {
    path: 'x.html',
    type: 'diff',
  });
}

// ── Recorder lifecycle ──────────────────────────────────────────────────────

test('dispose ignores later events', async () => {
  const { ledger, recorder } = await createWorkspace();
  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', 'write', { file_path: 'report.md', content: 'x' });

  recorder.dispose();

  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'write',
    args: { file_path: 'report.md' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  expect(ledger.list('session-1')).toEqual([]);
});

test('work version increases when the same artifact path is modified again', async () => {
  const { recorder } = await createWorkspace();
  recorder.onRunStart('run-1');
  for (const version of [1, 2]) {
    recorder.onToolStart(`call-${version}`, 'write', {
      file_path: 'report.md',
      content: `version-${version}`,
    });
    recorder.onToolEnd({
      toolCallId: `call-${version}`,
      toolName: 'write',
      args: { file_path: 'report.md', content: `version-${version}` },
      isError: false,
      resultMessageId: `message-${version}`,
    });
    expect(recorder.recordedWorkVersion()).toBe(version);
  }
  recorder.onRunStart('run-2');
  expect(recorder.recordedWorkVersion()).toBe(0);
  recorder.dispose();
});

test('script changes to an already recorded path still advance work version', async () => {
  const { root, recorder } = await createWorkspace();
  recorder.onRunStart('run-1');
  recorder.onToolStart('call-write', 'write', { file_path: 'report.xlsx', content: 'first' });
  recorder.onToolEnd({
    toolCallId: 'call-write',
    toolName: 'write',
    args: { file_path: 'report.xlsx', content: 'first' },
    isError: false,
    resultMessageId: 'message-write',
  });
  const coveredVersion = recorder.recordedWorkVersion();
  await fs.writeFile(path.join(root, 'report.xlsx'), 'changed by a script');
  const changedAt = new Date(Date.now() + 5_000);
  await fs.utimes(path.join(root, 'report.xlsx'), changedAt, changedAt);

  recorder.onToolEnd({
    toolCallId: 'call-script',
    toolName: 'python_execute',
    args: { code: 'update workbook' },
    isError: false,
    resultMessageId: 'message-script',
  });
  await recorder.flushDiffs();

  expect(recorder.recordedWorkVersion()).toBeGreaterThan(coveredVersion);
  recorder.dispose();
});

test('native read-only tools leave workspace scanning to the final capture', async () => {
  const { root, recorder, ledger } = await createWorkspace();
  recorder.onRunStart('run-1');
  await recorder.flushDiffs();
  const filePath = path.join(root, 'output.md');
  await fs.writeFile(filePath, 'A file to capture at settlement.');

  recorder.onToolEnd({
    toolCallId: 'read',
    toolName: 'read',
    isError: false,
    resultMessageId: 'read-result',
  });
  await recorder.flushDiffs();
  expect(ledger.list('session-1')).toEqual([]);

  await recorder.onRunSettled('answer');
  expect(ledger.listForRun('session-1', 'run-1')).toMatchObject([
    { filePath, messageId: 'answer' },
  ]);
  recorder.dispose();
});

test('a native continuation preserves pending outputs for the same Workbench run', async () => {
  const { root, recorder, ledger } = await createWorkspace();
  recorder.onRunStart('run-1');
  await recorder.flushDiffs();
  const target = path.join(root, 'continuation.md');
  await fs.writeFile(target, 'created before recovery');
  recorder.onToolEnd({
    toolCallId: 'create-file',
    toolName: 'bash',
    isError: false,
    resultMessageId: 'tool-result',
  });
  recorder.onRunStart('run-1');
  await expect(recorder.onRunSettled('final-answer')).resolves.toBe(1);

  expect(ledger.listForRun('session-1', 'run-1')).toEqual([
    expect.objectContaining({ filePath: target, messageId: 'final-answer' }),
  ]);
  recorder.dispose();
});

test('final capture waits for an in-flight scan before reading the latest workspace', async () => {
  const { root, recorder, ledger } = await createWorkspace();
  recorder.onRunStart('run-1');
  await recorder.flushDiffs();
  const firstPath = path.join(root, 'first.md');
  const lastPath = path.join(root, 'last.md');
  await fs.writeFile(firstPath, 'first output');
  const olderSnapshot = await takeWorkspaceSnapshot(root);
  const pendingScan = Promise.withResolvers<typeof olderSnapshot>();
  const started = Promise.withResolvers<void>();
  const snapshots = vi
    .spyOn(workspaceSnapshots, 'takeWorkspaceSnapshot')
    .mockImplementationOnce(() => {
      started.resolve();
      return pendingScan.promise;
    });
  recorder.onToolEnd({
    toolCallId: 'bash',
    toolName: 'bash',
    isError: false,
    resultMessageId: 'tool-result',
  });
  const scan = recorder.flushDiffs();
  await started.promise;
  await fs.writeFile(lastPath, 'output written before settlement');
  const capture = recorder.onRunSettled('final-answer');
  try {
    expect(snapshots).toHaveBeenCalledTimes(1);
  } finally {
    pendingScan.resolve(olderSnapshot);
    await Promise.all([scan, capture]);
    recorder.dispose();
  }
  expect(await capture).toBe(2);
  expect(ledger.listForRun('session-1', 'run-1')).toHaveLength(2);
  expect(ledger.listForRun('session-1', 'run-1')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ filePath: firstPath, messageId: 'tool-result' }),
      expect.objectContaining({ filePath: lastPath, messageId: 'final-answer' }),
    ]),
  );
});

test.each(['write', 'edit'])('%s is not counted again by the final scan', async toolName => {
  const { root, recorder } = await createWorkspace();
  const target = path.join(root, 'report.md');
  await fs.writeFile(target, 'before');
  recorder.onRunStart('run-1');
  recorder.onToolStart('call-1', toolName, { file_path: 'report.md', content: 'after' });
  await fs.writeFile(target, 'after');
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName,
    args: { file_path: 'report.md', content: 'after' },
    isError: false,
    resultMessageId: 'message-1',
  });
  const coveredVersion = recorder.recordedWorkVersion();

  recorder.onRunSettled('final-message');
  await recorder.settled();

  expect(recorder.recordedWorkVersion()).toBe(coveredVersion);
  recorder.dispose();
});
