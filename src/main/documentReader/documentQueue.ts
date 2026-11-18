const MAX_QUEUED_READS = 8;
const READ_TIMEOUT_MS = 120_000;

const queue: Array<() => void> = [];
let running = false;

function dispatch(): void {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  next();
}

/** Share a single conversion slot across sessions and release it after cancellation cleanup. */
export function queueDocumentRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (queue.length >= MAX_QUEUED_READS) throw new Error('The document read queue is full.');
  const queuedAt = performance.now();
  return new Promise((resolve, reject) => {
    const cancelQueued = () => {
      const index = queue.indexOf(start);
      if (index !== -1) queue.splice(index, 1);
      reject(signal?.reason);
    };
    const start = () => {
      signal?.removeEventListener('abort', cancelQueued);
      const startedAt = performance.now();
      const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
      const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      void Promise.resolve()
        .then(() => read(activeSignal))
        .then(resolve, reject)
        .finally(() => {
          console.debug(
            `[DocumentReader] finished after ${Math.round(startedAt - queuedAt)} ms queued and ${Math.round(performance.now() - startedAt)} ms running`,
          );
          running = false;
          dispatch();
        });
    };
    signal?.addEventListener('abort', cancelQueued, { once: true });
    queue.push(start);
    dispatch();
  });
}
