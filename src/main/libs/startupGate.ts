/**
 * Waits for a task to settle, bounded by a timeout.
 *
 * A stop has to hand back a state nobody is still mutating: returning while the
 * start-up it just cancelled is still unwinding leaves processes and files in
 * the air. The bound keeps a stuck task from hanging the stop forever, and the
 * caller decides what to report when the wait runs out.
 */
export function settleWithin(task: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const finish = (settled: boolean): void => {
      clearTimeout(timer);
      resolve(settled);
    };
    void task.then(
      () => finish(true),
      () => finish(true),
    );
  });
}
