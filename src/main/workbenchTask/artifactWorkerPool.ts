import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { collectWorkbenchArtifacts } from './artifactCollector';
import { ArtifactWorkerLimit } from './artifactWorkerConstants';

type Input = Parameters<typeof collectWorkbenchArtifacts>[0];
type Artifacts = ReturnType<typeof collectWorkbenchArtifacts>;
type Response = { artifacts?: Artifacts; error?: string; runMs: number };
type Job = {
  input: Input;
  queuedAt: number;
  resolve: (artifacts: Artifacts) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};
type Slot = { worker: Worker; job?: Job; startedAt?: number; timer?: NodeJS.Timeout };

export class WorkbenchArtifactWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];

  constructor(private readonly workerPath = path.join(__dirname, 'artifactWorker.js')) {}

  collect(input: Input, signal?: AbortSignal): Promise<Artifacts> {
    if (signal?.aborted) return Promise.reject(new Error('Artifact collection cancelled.'));
    const candidates =
      (input.artifactCandidates?.length ?? 0) +
      (Array.isArray(input.workflowSnapshot?.files) ? input.workflowSnapshot.files.length : 0) +
      (Array.isArray(input.workflowSnapshot?.artifacts)
        ? input.workflowSnapshot.artifacts.length
        : 0);
    if (
      candidates > ArtifactWorkerLimit.Candidates ||
      Buffer.byteLength(JSON.stringify(input)) > ArtifactWorkerLimit.InputBytes
    ) {
      return Promise.reject(new Error('Artifact collection input limit exceeded.'));
    }
    if (this.queue.length >= ArtifactWorkerLimit.Queue) {
      return Promise.reject(new Error('Artifact collection queue is full.'));
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        input,
        signal,
        resolve,
        reject,
        queuedAt: performance.now(),
        onAbort: () => {
          const slot = this.slots.find(candidate => candidate.job === job);
          if (slot) this.finish(slot, new Error('Artifact collection cancelled.'), true);
          else {
            const index = this.queue.indexOf(job);
            if (index >= 0) this.queue.splice(index, 1);
            signal?.removeEventListener('abort', job.onAbort);
            reject(new Error('Artifact collection cancelled.'));
          }
        },
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      this.queue.push(job);
      this.dispatch();
    });
  }

  dispose(): void {
    for (const job of this.queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(new Error('Artifact collection pool closed.'));
    }
    for (const slot of [...this.slots]) {
      this.finish(slot, new Error('Artifact collection pool closed.'), true);
    }
  }

  private dispatch(): void {
    while (this.queue.length) {
      let slot = this.slots.find(candidate => !candidate.job);
      if (!slot && this.slots.length < ArtifactWorkerLimit.Workers) {
        const worker = new Worker(this.workerPath);
        slot = { worker };
        const created = slot;
        worker.on('message', (response: Response) => {
          const job = created.job;
          if (!job) return;
          console.debug(
            `[WorkbenchArtifacts] collected run ${job.input.runId} after ${Math.round(created.startedAt! - job.queuedAt)} ms queued and ${Math.round(response.runMs)} ms running`,
          );
          if (
            response.error ||
            !Array.isArray(response.artifacts) ||
            response.artifacts.some(
              artifact =>
                artifact.taskId !== job.input.taskId ||
                artifact.runId !== job.input.runId ||
                !/^[a-f0-9]{64}$/.test(artifact.contentHash) ||
                path.isAbsolute(artifact.reference) ||
                artifact.reference.split(/[/\\]/)[0] === '..',
            )
          ) {
            this.finish(created, new Error(response.error || 'Invalid artifact worker result.'));
          } else {
            this.finish(created, undefined, false, response.artifacts);
          }
        });
        worker.on('error', error => this.finish(created, error, true));
        worker.on('exit', () => {
          if (this.slots.includes(created)) {
            this.finish(created, new Error('Artifact worker exited unexpectedly.'), true);
          }
        });
        this.slots.push(slot);
      }
      if (!slot) return;
      slot.job = this.queue.shift()!;
      slot.startedAt = performance.now();
      slot.worker.ref();
      slot.timer = setTimeout(
        () => this.finish(slot!, new Error('Artifact collection timed out.'), true),
        ArtifactWorkerLimit.TimeoutMs,
      );
      try {
        slot.worker.postMessage(slot.job.input);
      } catch (error) {
        this.finish(slot, error instanceof Error ? error : new Error(String(error)), true);
      }
    }
  }

  private finish(slot: Slot, error?: Error, terminate = false, artifacts?: Artifacts): void {
    const job = slot.job;
    clearTimeout(slot.timer);
    slot.job = undefined;
    if (terminate) {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      void slot.worker.terminate();
    } else slot.worker.unref();
    if (job) {
      job.signal?.removeEventListener('abort', job.onAbort);
      if (error) job.reject(error);
      else job.resolve(artifacts!);
    }
    this.dispatch();
  }
}

const pool = new WorkbenchArtifactWorkerPool();
export const collectWorkbenchArtifactsAsync = (
  input: Input,
  signal?: AbortSignal,
): Promise<Artifacts> => pool.collect(input, signal);
