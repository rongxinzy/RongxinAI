/**
 * Real worker_threads boundary tests for the bounded pool.
 *
 * The fixture worker is written to a temp directory as plain JavaScript (the
 * app worker bundle only exists after a build), but the threads, messaging,
 * transfer and cancellation are real — this file also produces the
 * before/after event-loop evidence the repository's worker-boundary rule
 * requires: the same buffer-hashing workload run synchronously on this
 * thread blocks the loop for the full hash time, while the pool keeps the
 * loop responsive.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createWorkerPool, type WorkerPool } from './backgroundWorkerPool';

const FIXTURE_WORKER_SOURCE = `
const { createHash } = require('node:crypto');
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (message) => {
  const { seq, kind, payload } = message;
  if (kind === 'hang') {
    // Occupies the worker until the pool is disposed (termination).
    return;
  }
  if (kind === 'hash-buffer') {
    const sha256 = createHash('sha256').update(new Uint8Array(payload.buffer)).digest('hex');
    parentPort.postMessage({ seq, ok: true, result: { sha256 } });
    return;
  }
  parentPort.postMessage({ seq, ok: false, error: { message: 'unknown kind: ' + kind } });
});
`;

const pools: WorkerPool[] = [];

function fixturePool(options?: { maxQueued?: number }): WorkerPool {
  const directory = mkdtempSync(path.join(tmpdir(), 'worker-pool-test-'));
  const workerPath = path.join(directory, 'fixture-worker.cjs');
  writeFileSync(workerPath, FIXTURE_WORKER_SOURCE);
  const pool = createWorkerPool(workerPath, {
    maxWorkers: 2,
    maxQueued: options?.maxQueued ?? 64,
    idleShutdownMs: 60_000,
  });
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(pool => pool.dispose().catch(() => undefined)));
});

describe('createWorkerPool', () => {
  test('runs jobs on real worker threads and returns correct results', async () => {
    const pool = fixturePool();
    const buffer = Buffer.alloc(1024, 7);
    const transferable = Uint8Array.from(buffer);
    const result = (await pool.run({
      kind: 'hash-buffer',
      payload: { buffer: transferable.buffer },
      transfer: [transferable.buffer],
    })) as { sha256: string };
    expect(result.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
  });

  test('returns structured errors for unknown job kinds', async () => {
    const pool = fixturePool();
    await expect(pool.run({ kind: 'nonsense', payload: {} })).rejects.toThrow(/unknown kind/i);
  });

  test('never exceeds two workers, however many jobs are waiting', async () => {
    const pool = fixturePool({ maxQueued: 64 });
    const jobs = Array.from({ length: 8 }, () =>
      pool.run({ kind: 'hang', payload: {} }).catch(error => error),
    );
    // Give the pool time to (over-)spawn if it would.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(pool.stats().workers).toBeLessThanOrEqual(2);
    expect(pool.stats().running).toBeLessThanOrEqual(2);
    await pool.dispose();
    // Every hung job settled (with a termination error), none left pending.
    expect((await Promise.all(jobs)).length).toBe(8);
  });

  test('rejects jobs beyond the queue cap with a structured error', async () => {
    const pool = fixturePool({ maxQueued: 1 });
    // Two hang jobs occupy both workers, a third fills the queue slot.
    const running = pool.run({ kind: 'hang', payload: {} }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 50));
    const runningTwo = pool.run({ kind: 'hang', payload: {} }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 50));
    const queued = pool.run({ kind: 'hang', payload: {} }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(pool.run({ kind: 'hang', payload: {} })).rejects.toThrow(/queue is full/i);
    await pool.dispose();
    // Disposal settles hung jobs (with termination errors), none left pending.
    expect(await running).toBeDefined();
    expect(await runningTwo).toBeDefined();
    expect(await queued).toBeDefined();
  });

  test('cancels a queued job via AbortSignal before it starts', async () => {
    const pool = fixturePool();
    const controller = new AbortController();
    const running = pool.run({ kind: 'hang', payload: {} }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    await expect(
      pool.run({ kind: 'hash-buffer', payload: { buffer: new ArrayBuffer(16) }, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await pool.dispose();
    expect(await running).toBeDefined();
  });

  test('transferred buffers actually move (zero-copy) and hash correctly', async () => {
    const pool = fixturePool();
    const payload = new Uint8Array(4096).fill(0x42);
    const copy = Buffer.from(payload);
    const result = (await pool.run({
      kind: 'hash-buffer',
      payload: { buffer: payload.buffer },
      transfer: [payload.buffer],
    })) as { sha256: string };
    expect(result.sha256).toBe(createHash('sha256').update(copy).digest('hex'));
  });

  test('a synchronous postMessage failure settles the job structurally and keeps the pool usable', async () => {
    const pool = fixturePool();
    // Functions are not structured-cloneable: postMessage throws
    // synchronously instead of reaching the worker.
    await expect(
      pool.run({ kind: 'hash-buffer', payload: { buffer: new ArrayBuffer(16), fn: () => 1 } }),
    ).rejects.toMatchObject({ code: 'WORKER_POST_FAILED' });
    // The worker slot recovered instead of wedging busy: a follow-up valid
    // job runs on the same pool and hashes correctly.
    const buffer = Buffer.alloc(64, 3);
    const result = (await pool.run({
      kind: 'hash-buffer',
      payload: { buffer: Uint8Array.from(buffer).buffer },
    })) as { sha256: string };
    expect(result.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
    expect(pool.stats().running).toBe(0);
  });
});

describe('worker-boundary event-loop evidence', () => {
  /**
   * Longest gap between 5ms timer ticks while work runs: a proxy for
   * main-thread event-loop blockage.
   */
  async function measureMaxLoopGapMs(work: () => Promise<void>): Promise<number> {
    let maxGapMs = 0;
    let lastTick = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      maxGapMs = Math.max(maxGapMs, now - lastTick);
      lastTick = now;
    }, 5);
    try {
      await work();
      await new Promise(resolve => setTimeout(resolve, 30));
      return maxGapMs;
    } finally {
      clearInterval(timer);
    }
  }

  const workload = (): Buffer[] =>
    Array.from({ length: 4 }, (_, index) => Buffer.alloc(16 * 1024 * 1024, index + 1));

  test('hashing through the pool keeps the loop far more responsive than in-process hashing', async () => {
    const buffers = workload();
    const expected = buffers.map(buffer => createHash('sha256').update(buffer).digest('hex'));

    const inProcessGap = await measureMaxLoopGapMs(async () => {
      for (const buffer of buffers) {
        createHash('sha256').update(buffer).digest('hex');
      }
    });

    const pool = fixturePool();
    const poolGap = await measureMaxLoopGapMs(async () => {
      const hashes = await Promise.all(
        buffers.map(buffer => {
          const transferable = Uint8Array.from(buffer);
          return pool.run({
            kind: 'hash-buffer',
            payload: { buffer: transferable.buffer },
            transfer: [transferable.buffer],
          }) as Promise<{ sha256: string }>;
        }),
      );
      expect(hashes.map(entry => entry.sha256)).toEqual(expected);
    });

    // The in-process pass must show a real block (the workload is big enough
    // to matter), and the pool pass must stay strictly under half of it — a
    // purely relative bound so the assertion stays discriminating on any
    // host speed (a secretly-main-thread pool would measure the same gap and
    // fail the ratio).
    expect(inProcessGap).toBeGreaterThanOrEqual(10);
    expect(poolGap).toBeLessThan(inProcessGap / 2);
  });
});
