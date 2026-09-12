/**
 * Bounded worker_threads pool for blocking background work in the Electron
 * main process.
 *
 * Repository rules (AGENTS.md "Main Process / Worker Boundary"): at most two
 * background workers, a bounded queue with structured overflow errors,
 * cancellation for queued jobs, structured error results, queue wait/run
 * metrics, and idle shutdown so packaged apps do not hold threads forever.
 * Main-process callers keep ownership of paths, writes and user-visible
 * state; the pool only moves serializable compute off the event loop.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface WorkerPoolJob {
  /** Job discriminator; interpreted by the worker entry. */
  kind: string;
  /** JSON-serializable payload. */
  payload: unknown;
  /** ArrayBuffers to transfer instead of cloning. */
  transfer?: ArrayBuffer[];
  signal?: AbortSignal;
}

export interface WorkerPoolJobMetrics {
  waitMs: number;
  runMs: number;
}

export type WorkerPoolOutcome =
  | { ok: true; result: unknown; metrics: WorkerPoolJobMetrics }
  | { ok: false; error: { message: string; code?: string }; metrics: WorkerPoolJobMetrics };

export interface WorkerPoolOptions {
  /** Hard cap of simultaneously running workers (repository maximum: 2). */
  maxWorkers?: number;
  /** Hard cap of jobs waiting for a worker; excess jobs reject structurally. */
  maxQueued?: number;
  /** Terminate idle workers after this long (default 30s). */
  idleShutdownMs?: number;
}

interface PendingJob {
  job: WorkerPoolJob;
  resolve: (outcome: WorkerPoolOutcome) => void;
  enqueuedAt: number;
}

interface PoolWorker {
  worker: Worker;
  busy: JobSlot | null;
}

interface JobSlot {
  seq: number;
  startedAt: number;
  resolve: (outcome: WorkerPoolOutcome) => void;
}

const TERMINATED_ERROR_CODE = 'WORKER_POOL_DISPOSED';

export interface WorkerPool {
  run(job: WorkerPoolJob): Promise<unknown>;
  dispose(): Promise<void>;
  /** Snapshot for diagnostics/tests: queue depth and live worker count. */
  stats(): { queued: number; workers: number; running: number };
}

/**
 * Create a bounded pool executing jobs on a worker entry script. The worker
 * must reply to every accepted job with {seq, ok, result} | {seq, ok: false,
 * error: {message, code?}} — see solPiComputeJobs.ts for the SoL-Pi envelope.
 */
export function createWorkerPool(
  scriptUrl: string,
  options: WorkerPoolOptions = {},
): WorkerPool {
  const maxWorkers = Math.max(1, Math.min(2, options.maxWorkers ?? 2));
  const maxQueued = Math.max(1, options.maxQueued ?? 64);
  const idleShutdownMs = options.idleShutdownMs ?? 30_000;
  const scriptPath = scriptUrl.startsWith('file:')
    ? fileURLToPath(scriptUrl)
    : scriptUrl;

  const queue: PendingJob[] = [];
  const workers: PoolWorker[] = [];
  let disposed = false;
  let nextSeq = 1;

  const fail = (job: PendingJob, error: { message: string; code?: string }): WorkerPoolOutcome => {
    const metrics = { waitMs: Date.now() - job.enqueuedAt, runMs: 0 };
    return { ok: false, error, metrics };
  };

  const settle = (job: PendingJob, outcome: WorkerPoolOutcome): void => {
    if (outcome.metrics.waitMs > 1_000 || outcome.metrics.runMs > 10_000) {
      // One summary line for slow jobs only; the hot path stays silent.
      console.debug(
        `[WorkerPool] job ${job.job.kind} waited ${outcome.metrics.waitMs}ms ran ${outcome.metrics.runMs}ms`,
      );
    }
    job.resolve(outcome);
  };

  const onWorkerMessage = (poolWorker: PoolWorker, message: unknown): void => {
    const slot = poolWorker.busy;
    if (!slot) return;
    const reply = message as { seq?: number; ok?: boolean; result?: unknown; error?: { message: string; code?: string } };
    if (reply.seq !== slot.seq) return;
    poolWorker.busy = null;
    const outcome: WorkerPoolOutcome = reply.ok
      ? { ok: true, result: reply.result, metrics: { waitMs: 0, runMs: Date.now() - slot.startedAt } }
      : {
          ok: false,
          error: reply.error ?? { message: 'Worker job failed without an error payload' },
          metrics: { waitMs: 0, runMs: Date.now() - slot.startedAt },
        };
    slot.resolve(outcome);
    pump();
  };

  const onWorkerDead = (poolWorker: PoolWorker, reason: { message: string; code?: string }): void => {
    const index = workers.indexOf(poolWorker);
    if (index >= 0) workers.splice(index, 1);
    const slot = poolWorker.busy;
    poolWorker.busy = null;
    slot?.resolve({
      ok: false,
      error: reason,
      metrics: { waitMs: 0, runMs: Date.now() - slot.startedAt },
    });
    pump();
  };

  const spawnWorker = (): PoolWorker | null => {
    if (disposed) return null;
    let poolWorker: PoolWorker;
    try {
      const worker = new Worker(scriptPath, { resourceLimits: { maxOldGenerationSizeMb: 512 } });
      poolWorker = { worker, busy: null };
      worker.on('message', message => onWorkerMessage(poolWorker, message));
      worker.on('error', error => onWorkerDead(poolWorker, { message: error.message, code: 'WORKER_CRASHED' }));
      worker.on('exit', code => {
        if (!poolWorker.busy) return;
        onWorkerDead(poolWorker, {
          message: `Worker exited unexpectedly with code ${code}`,
          code: 'WORKER_EXITED',
        });
      });
      workers.push(poolWorker);
      return poolWorker;
    } catch (error) {
      console.error('[WorkerPool] failed to spawn worker:', error);
      return null;
    }
  };

  const scheduleIdleShutdown = (poolWorker: PoolWorker): void => {
    setTimeout(() => {
      if (disposed || poolWorker.busy) return;
      const index = workers.indexOf(poolWorker);
      if (index >= 0) workers.splice(index, 1);
      void poolWorker.worker.terminate();
    }, idleShutdownMs).unref();
  };

  const claimNextJob = (): PendingJob | undefined => {
    while (queue.length > 0) {
      const job = queue.shift()!;
      if (job.job.signal?.aborted) {
        settle(job, fail(job, { message: 'Job cancelled before it started', code: 'CANCELLED' }));
        continue;
      }
      return job;
    }
    return undefined;
  };

  const startJob = (poolWorker: PoolWorker, job: PendingJob): void => {
    const seq = nextSeq++;
    const startedAt = Date.now();
    const slot: JobSlot = {
      seq,
      startedAt,
      resolve: outcome => {
        // Spread the settled outcome (kept as the union) with recomputed
        // wait metrics; boolean-literal narrowing is unavailable under this
        // project's non-strict main tsconfig.
        settle(job, {
          ...outcome,
          metrics: { waitMs: startedAt - job.enqueuedAt, runMs: outcome.metrics.runMs },
        });
        scheduleIdleShutdown(poolWorker);
      },
    };
    poolWorker.busy = slot;
    const send: Record<string, unknown> = { seq, kind: job.job.kind, payload: job.job.payload };
    if (job.job.signal?.aborted) {
      poolWorker.busy = null;
      settle(job, fail(job, { message: 'Job cancelled before it started', code: 'CANCELLED' }));
      scheduleIdleShutdown(poolWorker);
      pump();
      return;
    }
    try {
      poolWorker.worker.postMessage(send, job.job.transfer ?? []);
    } catch (error) {
      // A synchronous postMessage failure (uncloneable payload field,
      // mismatched transfer list) must settle the job and free the slot —
      // letting it propagate would wedge the worker as permanently busy and
      // two such failures would starve the capped pool.
      poolWorker.busy = null;
      settle(job, fail(job, {
        message: error instanceof Error ? error.message : String(error),
        code: 'WORKER_POST_FAILED',
      }));
      scheduleIdleShutdown(poolWorker);
      pump();
    }
  };

  const pump = (): void => {
    while (!disposed && queue.length > 0) {
      // Prefer an idle existing worker; spawn one only under the cap.
      let target = workers.find(candidate => !candidate.busy) ?? null;
      if (!target) {
        if (workers.length >= maxWorkers) return; // Saturated: wait for a free slot.
        target = spawnWorker();
        if (!target) {
          // Spawning failed (packaged layout, thread exhaustion). Fail queued
          // jobs structurally so callers can fall back; never hang.
          while (queue.length > 0) {
            const job = queue.shift()!;
            settle(job, fail(job, { message: 'No worker could be started', code: 'WORKER_SPAWN_FAILED' }));
          }
          return;
        }
      }
      const job = claimNextJob();
      if (!job) return;
      startJob(target, job);
    }
  };

  return {
    run(job: WorkerPoolJob): Promise<unknown> {
      return new Promise<unknown>((resolve, reject) => {
        if (disposed) {
          reject(new Error('Worker pool is disposed'));
          return;
        }
        if (queue.length >= maxQueued) {
          reject(new Error(`Worker pool queue is full (${maxQueued} waiting)`));
          return;
        }
        const pending: PendingJob = {
          job,
          enqueuedAt: Date.now(),
          resolve: outcome => {
            if ('error' in outcome) {
              reject(Object.assign(new Error(outcome.error.message), { code: outcome.error.code }));
            } else {
              resolve(outcome.result);
            }
          },
        };
        queue.push(pending);
        job.signal?.addEventListener(
          'abort',
          () => {
            const index = queue.indexOf(pending);
            if (index < 0) return;
            queue.splice(index, 1);
            settle(pending, fail(pending, { message: 'Job cancelled', code: 'CANCELLED' }));
          },
          { once: true },
        );
        pump();
      });
    },
    async dispose(): Promise<void> {
      disposed = true;
      while (queue.length > 0) {
        const job = queue.shift()!;
        settle(job, fail(job, { message: 'Worker pool disposed', code: TERMINATED_ERROR_CODE }));
      }
      await Promise.all(workers.map(poolWorker => poolWorker.worker.terminate()));
      workers.length = 0;
    },
    stats() {
      return {
        queued: queue.length,
        workers: workers.length,
        running: workers.filter(candidate => candidate.busy).length,
      };
    },
  };
}
