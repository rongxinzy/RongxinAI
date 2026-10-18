/**
 * Coverage parity: the event-time ledger must find every file-backed artifact
 * the renderer's message-reparse heuristic (detectArtifactsFromMessages)
 * found for the same scenarios, and strictly more for edit-tool rewrites and
 * files produced by non-file tools (bash). PR1 keeps the renderer detector as
 * the fallback; this suite proves the ledger can replace it on these paths.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import Database from 'better-sqlite3';

import { ArtifactLedger, normalizeArtifactKeyPath } from './artifactLedger';
import { initializeArtifactLedgerSchema } from './schema';
import { ArtifactRecorder } from './artifactRecorder';
import { setArtifactUpsertPublisher } from './publisher';
import { detectArtifactsFromMessages } from '../../renderer/services/artifactParser';
import type { CoworkMessage } from '../../renderer/types/cowork';

const workspaces: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  setArtifactUpsertPublisher(() => {});
  for (const db of databases.splice(0)) db.close();
  for (const dir of workspaces.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const waitForDiff = async (): Promise<void> => {
  await sleep(600);
  await sleep(120);
};

async function createWorkspace(): Promise<{
  root: string;
  ledger: ArtifactLedger;
  recorder: ArtifactRecorder;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-coverage-'));
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

/** Both sides keyed by the same normalized path convention for comparison. */
function filePathSet(paths: Array<string | undefined>): Set<string> {
  return new Set(
    paths
      .filter((value): value is string => typeof value === 'string')
      .map(value => normalizeArtifactKeyPath(value)),
  );
}

/**
 * Renderer-detected paths keep the raw tool argument (often relative); the
 * ledger resolves against the workspace root. Normalize both to absolute
 * before comparing.
 */
function resolveAgainstRoot(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function toolUseMessage(
  id: string,
  toolName: string,
  toolUseId: string,
  toolInput: Record<string, unknown>,
): CoworkMessage {
  return {
    id,
    type: 'tool_use',
    content: `Using tool: ${toolName}`,
    timestamp: Date.now(),
    metadata: { toolName, toolInput, toolUseId },
  } as CoworkMessage;
}

function toolResultMessage(id: string, toolUseId: string, isError = false): CoworkMessage {
  return {
    id,
    type: 'tool_result',
    content: 'ok',
    timestamp: Date.now(),
    metadata: { toolUseId, isError, isFinal: true },
  } as CoworkMessage;
}

function detectedPaths(messages: CoworkMessage[], root: string): Set<string> {
  return filePathSet(
    detectArtifactsFromMessages(messages, 'session-1').map(detected => {
      const raw = detected.artifact.filePath;
      return raw ? resolveAgainstRoot(root, raw) : undefined;
    }),
  );
}

function ledgerPaths(ledger: ArtifactLedger): Set<string> {
  return filePathSet(ledger.list('session-1').map(artifact => artifact.filePath));
}

test('ledger covers the write-tool artifacts the renderer detector found', async () => {
  const { root, ledger, recorder } = await createWorkspace();
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

  const messages = [
    toolUseMessage('m-tool-1', 'write', 'call-1', {
      file_path: 'reports/report.md',
      content: '# Title',
    }),
    toolResultMessage('m-result-1', 'call-1'),
  ];
  const renderer = detectedPaths(messages, root);
  expect(renderer.size).toBeGreaterThanOrEqual(1);
  const ledgerSide = ledgerPaths(ledger);
  for (const rendererPath of renderer) expect(ledgerSide.has(rendererPath)).toBe(true);
  recorder.dispose();
});

test('ledger is strictly ahead of the renderer detector for edit rewrites', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  const target = path.join(root, 'src', 'overview.md');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
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

  const messages = [
    toolUseMessage('m-tool-1', 'edit', 'call-1', { file_path: 'src/overview.md' }),
    toolResultMessage('m-result-1', 'call-1'),
  ];
  // The renderer heuristic only records write tools with content.
  const renderer = detectedPaths(messages, root);
  expect(renderer.has(normalizeArtifactKeyPath(target))).toBe(false);
  const ledgerSide = ledgerPaths(ledger);
  expect(ledgerSide.has(normalizeArtifactKeyPath(target))).toBe(true);
  expect(ledgerSide.size).toBeGreaterThan(renderer.size);
  recorder.dispose();
});

test('ledger is strictly ahead of the renderer detector for bash-produced files', async () => {
  const { root, ledger, recorder } = await createWorkspace();
  recorder.onRunStart('run-1');
  await sleep(50);
  const docPath = path.join(root, 'export.docx');
  await fs.writeFile(docPath, Buffer.from('binary'));
  recorder.onToolEnd({
    toolCallId: 'call-1',
    toolName: 'bash',
    args: { command: 'libreoffice --convert-to docx' },
    isError: false,
    resultMessageId: 'm-result-1',
  });
  await waitForDiff();

  const messages = [
    toolUseMessage('m-tool-1', 'bash', 'call-1', { command: 'libreoffice --convert-to docx' }),
    toolResultMessage('m-result-1', 'call-1'),
  ];
  const renderer = detectedPaths(messages, root);
  expect(renderer.size).toBe(0);
  const ledgerSide = ledgerPaths(ledger);
  expect(ledgerSide.has(normalizeArtifactKeyPath(docPath))).toBe(true);
  recorder.dispose();
});

test('ledger covers declarations, external writes, and failed writes like the detector', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-cov-out-'));
  workspaces.push(outside);
  const { root, ledger, recorder } = await createWorkspace();
  const outsideFile = path.join(outside, 'deliverable.html');
  const missingFile = path.join(root, 'missing', 'report.md');

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
    args: { filePath: outsideFile, role: 'deliverable' },
    result: { details: { filePath: outsideFile, role: 'deliverable', title: 'Deliverable' } },
    isError: false,
    resultMessageId: 'm-result-2',
  });
  // Failed write: neither side records it.
  recorder.onToolStart('call-3', 'write', { file_path: missingFile, content: 'x' });
  recorder.onToolEnd({
    toolCallId: 'call-3',
    toolName: 'write',
    args: { file_path: missingFile, content: 'x' },
    isError: true,
    result: 'failed',
    resultMessageId: 'm-result-3',
  });

  const messages = [
    toolUseMessage('m-tool-1', 'write', 'call-1', {
      file_path: outsideFile,
      content: '<h1>hi</h1>',
    }),
    toolResultMessage('m-result-1', 'call-1'),
    toolUseMessage('m-tool-2', 'declare_artifact', 'call-2', {
      filePath: outsideFile,
      role: 'deliverable',
      title: 'Deliverable',
    }),
    toolResultMessage('m-result-2', 'call-2'),
    toolUseMessage('m-tool-3', 'write', 'call-3', { file_path: missingFile, content: 'x' }),
    toolResultMessage('m-result-3', 'call-3', true),
  ];
  const renderer = detectedPaths(messages, root);
  const ledgerSide = ledgerPaths(ledger);
  for (const rendererPath of renderer) expect(ledgerSide.has(rendererPath)).toBe(true);
  expect(ledgerSide.has(normalizeArtifactKeyPath(missingFile))).toBe(false);
  expect(renderer.has(normalizeArtifactKeyPath(missingFile))).toBe(false);
  recorder.dispose();
});
