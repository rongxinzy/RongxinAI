import { boundWorkerInput } from './boundedWorkerInput';
import {
  boundToolResult,
  TextWorkerKind,
  type TextWorkerInput,
  type TextWorkerOutput,
} from './textWorkerOperations';
import { CoworkRunPolicy } from '../../shared/cowork/runState';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { collectWorkbenchArtifacts } from './artifactCollector';
import { ArtifactWorkerLimit, ArtifactWorkerTask } from './artifactWorkerConstants';
import type { ArtifactWorkerInput, WorkspaceContentInspection } from './artifactWorkerTypes';

type Input = Parameters<typeof collectWorkbenchArtifacts>[0];
type Artifacts = ReturnType<typeof collectWorkbenchArtifacts>;
type Result = Artifacts | WorkspaceContentInspection | TextWorkerOutput;
type Response = {
  artifacts?: Artifacts;
  text?: TextWorkerOutput;
  content?: WorkspaceContentInspection;
  error?: string;
  runMs: number;
};
type Job = {
  task: ArtifactWorkerInput;
  queuedAt: number;
  resolve: (result: Result) => void;
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
    if (candidates > ArtifactWorkerLimit.Candidates)
      return Promise.reject(new Error('Artifact collection input limit exceeded.'));
    try {
      input = boundWorkerInput(input, {
        nodes: 4096,
        depth: 16,
        characters: ArtifactWorkerLimit.InputBytes,
      }) as Input;
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue({ kind: ArtifactWorkerTask.Collect, input }, signal).then(
      result => result as Artifacts,
    );
  }

  transform(input: TextWorkerInput, signal?: AbortSignal): Promise<TextWorkerOutput> {
    if (
      input.kind === TextWorkerKind.Content &&
      (input.content.length > CoworkRunPolicy.MaximumContentCharacters + 1 ||
        input.previous.length > CoworkRunPolicy.MaximumContentCharacters)
    )
      return Promise.reject(new Error('Content input limit exceeded.'));
    try {
      return this.enqueue(
        {
          kind: ArtifactWorkerTask.TransformText,
          input:
            input.kind === TextWorkerKind.Tool
              ? { ...input, result: boundToolResult(input.result) }
              : input,
        },
        signal,
      ) as Promise<TextWorkerOutput>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  inspectContent(bytes: ArrayBuffer, signal?: AbortSignal): Promise<WorkspaceContentInspection> {
    if (bytes.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes) {
      return Promise.reject(new Error('Workspace content input limit exceeded.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.InspectWorkspaceContent, input: { bytes } },
      signal,
    ).then(result => result as WorkspaceContentInspection);
  }

  private enqueue(task: ArtifactWorkerInput, signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted) return Promise.reject(new Error('Artifact collection cancelled.'));
    if (this.queue.length >= ArtifactWorkerLimit.Queue) {
      return Promise.reject(new Error('Artifact collection queue is full.'));
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        task,
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
            `[WorkbenchArtifacts] completed ${job.task.kind} after ${Math.round(created.startedAt! - job.queuedAt)} ms queued and ${Math.round(response.runMs)} ms running`,
          );
          if (job.task.kind === ArtifactWorkerTask.TransformText) {
            const text = response.text;
            if (
              response.error ||
              !text ||
              typeof text.content !== 'string' ||
              text.content.length > CoworkRunPolicy.MaximumContentCharacters ||
              !Number.isSafeInteger(text.offset) ||
              text.offset < 0
            )
              this.finish(created, new Error(response.error || 'Invalid text worker result.'));
            else this.finish(created, undefined, false, text);
          } else if (job.task.kind === ArtifactWorkerTask.InspectWorkspaceContent) {
            const content = response.content;
            if (
              response.error ||
              !content ||
              !/^[a-f0-9]{64}$/.test(content.sha256) ||
              typeof content.text !== 'string' ||
              typeof content.binary !== 'boolean' ||
              content.text.length > ArtifactWorkerLimit.WorkspaceContentBytes
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid workspace content worker result.'),
              );
            } else {
              this.finish(created, undefined, false, content);
            }
          } else if (
            response.error ||
            !Array.isArray(response.artifacts) ||
            response.artifacts.some(
              artifact =>
                artifact.taskId !== (job.task.input as Input).taskId ||
                artifact.runId !== (job.task.input as Input).runId ||
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
        const task = slot.job.task;
        slot.worker.postMessage(
          task,
          task.kind === ArtifactWorkerTask.InspectWorkspaceContent ? [task.input.bytes] : [],
        );
      } catch (error) {
        this.finish(slot, error instanceof Error ? error : new Error(String(error)), true);
      }
    }
  }

  private finish(slot: Slot, error?: Error, terminate = false, result?: Result): void {
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
      else job.resolve(result!);
    }
    this.dispatch();
  }
}

const pool = new WorkbenchArtifactWorkerPool();
export const collectWorkbenchArtifactsAsync = (
  input: Input,
  signal?: AbortSignal,
): Promise<Artifacts> => pool.collect(input, signal);

export const inspectWorkspaceContentAsync = (
  content: Uint8Array,
  signal?: AbortSignal,
): Promise<WorkspaceContentInspection> => {
  if (content.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes) {
    return Promise.reject(new Error('Workspace content input limit exceeded.'));
  }
  // Own a bounded immutable copy: transferring a pooled Node Buffer can detach
  // unrelated contents, and main still owns the bytes used for the file write.
  return pool.inspectContent(Uint8Array.from(content).buffer, signal);
};

export const transformCoworkTextAsync = (
  input: TextWorkerInput,
  signal?: AbortSignal,
): Promise<TextWorkerOutput> => pool.transform(input, signal);
