import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { AISphereError } from '../../../shared/aisphere';
import { prepareRequestBody, type PreparedRequest } from './requestBody';

/** One reusable worker; bounded submissions prevent chat payloads starving the main process. */
export class AISphereRequestPool {
  constructor(private readonly workerFile = path.join(__dirname, 'requestWorker.js')) {}
  private worker?: Worker;
  private submitted = 0;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (result: PreparedRequest) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();

  run(body: string, signal: AbortSignal, maxTokens?: number): Promise<PreparedRequest> {
    if (body.length > 16 * 1024 * 1024 || this.submitted >= 8 || signal.aborted) {
      return Promise.reject(new Error(AISphereError.RequestRejected));
    }
    if (!fs.existsSync(this.workerFile)) {
      try {
        return Promise.resolve(prepareRequestBody(body, maxTokens));
      } catch {
        return Promise.reject(new Error(AISphereError.RequestRejected));
      }
    }
    if (!this.worker) {
      this.worker = new Worker(this.workerFile);
      this.worker.unref();
      this.worker.on(
        'message',
        (message: { id: number; result?: PreparedRequest; error?: boolean }) => {
          this.submitted -= 1;
          const job = this.pending.get(message.id);
          if (!job) return;
          this.pending.delete(message.id);
          job.cleanup();
          if (message.result) job.resolve(message.result);
          else job.reject(new Error(AISphereError.RequestRejected));
        },
      );
      this.worker.on('error', () => this.close());
      this.worker.on('exit', () => this.close());
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => {
        this.pending.delete(id);
        cleanup();
        reject(new Error(AISphereError.RequestRejected));
      };
      const timeout = setTimeout(abort, 10000);
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      this.submitted += 1;
      worker.postMessage({ id, body, maxTokens });
    });
  }

  close(): void {
    this.submitted = 0;
    const worker = this.worker;
    this.worker = undefined;
    worker?.removeAllListeners();
    void worker?.terminate();
    for (const job of this.pending.values()) {
      job.cleanup();
      job.reject(new Error(AISphereError.RequestRejected));
    }
    this.pending.clear();
  }
}
