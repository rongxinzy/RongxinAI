/**
 * SoL-Pi compute worker entry.
 *
 * Bound by createWorkerPool (src/main/libs/backgroundWorkerPool.ts) via the
 * worker bundle emitted next to the main bundle. Accepts
 * {seq, kind, payload} messages (ArrayBuffers transferred where practical)
 * and replies with the SolPiComputeReply envelope. All job semantics live in
 * solPiComputeWorkerCore.ts so they are unit-testable without a thread.
 */
import { parentPort } from 'node:worker_threads';

import { executeSolPiComputeJob } from '../libs/solPi/solPiComputeWorkerCore';

if (!parentPort) {
  throw new Error('solPiComputeWorker must be started as a worker_threads Worker');
}

parentPort.on('message', (message: { seq: number; kind: string; payload: unknown }) => {
  void executeSolPiComputeJob(message.kind, message.payload).then(
    result => {
      parentPort!.postMessage({ seq: message.seq, ok: true, result });
    },
    (error: NodeJS.ErrnoException) => {
      parentPort!.postMessage({
        seq: message.seq,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error), code: error?.code },
      });
    },
  );
});
