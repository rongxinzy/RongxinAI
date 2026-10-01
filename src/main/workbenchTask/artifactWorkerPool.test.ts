import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { WorkbenchArtifactCandidateSource } from '../../shared/workbenchTask';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { WorkbenchArtifactWorkerPool } from './artifactWorkerPool';
import { ArtifactWorkerLimit } from './artifactWorkerConstants';
import { TextWorkerKind } from './textWorkerOperations';
import { CoworkRunPolicy } from '../../shared/cowork/runState';

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-worker-test-')));
const compiled = path.join(fixture, 'compiled');
let pool: WorkbenchArtifactWorkerPool;
const input = {
  taskId: 'task',
  runId: 'run',
  workspaceRoot: fixture,
  finalAnswer: '',
  artifactCandidates: [{ path: 'result.txt', source: WorkbenchArtifactCandidateSource.ToolEffect }],
};
beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ESNext',
      '--types',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      compiled,
      'src/main/workbenchTask/artifactWorker.ts',
    ],
    { stdio: 'inherit' },
  );
  pool = new WorkbenchArtifactWorkerPool(
    path.join(compiled, 'main/workbenchTask/artifactWorker.js'),
  );
  fs.writeFileSync(path.join(fixture, 'result.txt'), 'final output');
});
afterAll(() => {
  pool?.dispose();
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('the worker returns the same hashes and rejects paths outside the workspace', async () => {
  expect(await pool.collect(input)).toEqual(collectWorkbenchArtifacts(input));
  expect(
    await pool.collect({
      ...input,
      artifactCandidates: [
        { path: '../outside.txt', source: WorkbenchArtifactCandidateSource.ToolEffect },
      ],
    }),
  ).toEqual([]);
});
test('collection enforces input limits and supports cancellation', async () => {
  await expect(
    pool.collect({
      ...input,
      artifactCandidates: Array.from(
        { length: ArtifactWorkerLimit.Candidates + 1 },
        () => input.artifactCandidates[0],
      ),
    }),
  ).rejects.toThrow('input limit');
  const cancellation = new AbortController();
  const pending = pool.collect(input, cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect(await pool.collect(input)).toHaveLength(1);
});
test('oversized files fail with a structured worker error', async () => {
  const largePath = path.join(fixture, 'large.txt');
  fs.closeSync(fs.openSync(largePath, 'w'));
  fs.truncateSync(largePath, ArtifactWorkerLimit.FileBytes + 1);
  await expect(
    pool.collect({
      ...input,
      artifactCandidates: [
        { path: largePath, source: WorkbenchArtifactCandidateSource.ToolEffect },
      ],
    }),
  ).rejects.toThrow('file size limit');
});
test('file hashing leaves the main event loop responsive compared with the synchronous baseline', async () => {
  const filePath = path.join(fixture, 'timing.txt');
  fs.writeFileSync(filePath, Buffer.alloc(32 * 1024 * 1024, 65));
  const timingInput = {
    ...input,
    artifactCandidates: Array.from({ length: 8 }, () => ({
      path: filePath,
      source: WorkbenchArtifactCandidateSource.ToolEffect,
    })),
  };
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 1);
  try {
    const syncStarted = performance.now();
    const baseline = collectWorkbenchArtifacts(timingInput);
    const syncMs = performance.now() - syncStarted;
    expect(ticks).toBe(0);
    const workerStarted = performance.now();
    const result = await pool.collect(timingInput);
    const workerMs = performance.now() - workerStarted;
    expect(result).toEqual(baseline);
    expect(ticks).toBeGreaterThan(0);
    console.log(
      `[WorkbenchArtifactTest] synchronous collection blocked for ${Math.round(syncMs)} ms; worker collection took ${Math.round(workerMs)} ms with ${ticks} main-thread timer ticks`,
    );
  } finally {
    clearInterval(interval);
  }
});

test('tool display and content comparison share the bounded worker pool and support cancellation', async () => {
  const content = '中文\n'.repeat(60_000) + 'END';
  expect(
    await pool.transform({
      kind: TextWorkerKind.Content,
      content,
      previous: content.slice(0, 90_000),
      reset: false,
    }),
  ).toMatchObject({ content: content.slice(90_000), offset: 90_000, truncated: false });
  expect(
    await pool.transform({
      kind: TextWorkerKind.Tool,
      result: { content: [{ text: 'first' }, { text: 'last' }] },
    }),
  ).toMatchObject({ content: 'first\nlast' });
  const cancellation = new AbortController();
  const pending = pool.transform(
    { kind: TextWorkerKind.Content, content, previous: content, reset: false },
    cancellation.signal,
  );
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  await expect(
    pool.transform({
      kind: TextWorkerKind.Content,
      content: 'x'.repeat(CoworkRunPolicy.MaximumContentCharacters + 2),
      previous: '',
      reset: false,
    }),
  ).rejects.toThrow('input limit');
});
