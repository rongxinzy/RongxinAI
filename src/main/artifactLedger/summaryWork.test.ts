import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import { ArtifactLedger } from './artifactLedger';
import { ArtifactRecorder } from './artifactRecorder';
import { initializeArtifactLedgerSchema } from './schema';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function createRecorder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-work-'));
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  );
  initializeArtifactLedgerSchema(db);
  const ledger = new ArtifactLedger(db);
  const recorder = new ArtifactRecorder({ sessionId: 'session-1', workspaceRoot: root, ledger });
  cleanups.push(async () => {
    recorder.dispose();
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  recorder.onRunStart('run-1');
  await recorder.flushDiffs();
  return { root, ledger, recorder };
}

async function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

const internalStatePaths = [
  '.zhiyuan/shortcut-workflows/session-1/state.json',
  '.zhiyuan/research/session-1/research-state.json',
  '.zhiyuan/research/session-1/state/progress.json',
];

test.each(internalStatePaths)(
  'state scans preserve checkpoint coverage and ledger evidence: %s',
  async statePath => {
    const { root, ledger, recorder } = await createRecorder();
    for (const version of [1, 2, 3]) {
      await writeFile(root, 'report.md', `version ${version}`);
      recorder.onToolEnd({
        toolCallId: `write-${version}`,
        toolName: 'write',
        args: { file_path: 'report.md' },
        isError: false,
        resultMessageId: `message-${version}`,
      });
      await recorder.flushDiffs();
    }
    const coveredVersion = recorder.recordedWorkVersion();
    expect(coveredVersion).toBe(3);
    const target = await writeFile(root, statePath, '{"completed":false}');
    recorder.onToolEnd({
      toolCallId: 'state-create',
      toolName: 'workflow_state',
      isError: false,
      resultMessageId: 'state-created',
    });
    await recorder.flushDiffs();
    expect(recorder.recordedWorkVersion()).toBe(coveredVersion);
    expect(ledger.list('session-1')).toHaveLength(2);

    await fs.writeFile(target, '{"completed":true}');
    const changedAt = new Date(Date.now() + 5_000);
    await fs.utimes(target, changedAt, changedAt);
    recorder.onRunSettled('final-answer');
    await recorder.settled();
    expect(recorder.recordedWorkVersion()).toBe(coveredVersion);

    await fs.writeFile(path.join(root, 'report.md'), 'substantive correction');
    await fs.utimes(path.join(root, 'report.md'), changedAt, changedAt);
    recorder.onRunSettled('corrected-answer');
    await recorder.settled();
    expect(recorder.recordedWorkVersion()).toBeGreaterThan(coveredVersion);
  },
);

test('state-only scans do not create a summary obligation', async () => {
  const { root, ledger, recorder } = await createRecorder();
  await writeFile(root, internalStatePaths[0], '{}');
  recorder.onRunSettled('final-answer');
  await recorder.settled();
  expect(ledger.list('session-1')).toHaveLength(1);
  expect(recorder.hasRecordedFiles()).toBe(false);
  expect(recorder.recordedWorkVersion()).toBe(0);
});

test.each(['write', 'edit', 'declare_artifact'])(
  'state-only %s keeps evidence without changing summary work',
  async toolName => {
    const { root, ledger, recorder } = await createRecorder();
    const target = await writeFile(root, internalStatePaths[0], '{}');
    recorder.onToolEnd({
      toolCallId: 'state-tool',
      toolName,
      args: { file_path: target },
      result: { details: { filePath: target, role: CoworkArtifactRole.Intermediate } },
      isError: false,
      resultMessageId: 'state-message',
    });
    recorder.onRunSettled('final-answer');
    await recorder.settled();
    expect(ledger.list('session-1')).toHaveLength(1);
    expect(recorder.hasRecordedFiles()).toBe(false);
    expect(recorder.recordedWorkVersion()).toBe(0);
  },
);

test.each([
  'state.json',
  'outputs/state.json',
  '.zhiyuan/shortcut-workflows/session-1/report.md',
  '.zhiyuan/research/session-1/report.md',
  '.zhiyuan/shortcut-workflows/session-1/exports/state.json',
])('ordinary output remains summary work: %s', async relativePath => {
  const { root, recorder } = await createRecorder();
  await writeFile(root, relativePath, 'user output');
  recorder.onRunSettled('final-answer');
  await recorder.settled();
  expect(recorder.hasRecordedFiles()).toBe(true);
  expect(recorder.recordedWorkVersion()).toBe(1);
  recorder.onRunStart('run-2');
  expect(recorder.hasRecordedFiles()).toBe(false);
});
