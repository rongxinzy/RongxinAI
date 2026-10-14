/**
 * Tracks whether a start-up sequence is still wanted.
 *
 * Starting the search bridge installs and compiles its runtime asynchronously,
 * so a stop can arrive while that work is in flight. Every step that outlives an
 * await has to re-check this gate, otherwise the server comes up after the app
 * already stopped it and survives as a stray process.
 */
export interface StartupAttempt {
  /** Identity of this attempt; compare it after every await. */
  token: number;
  /** Aborted by cancel(): hand it to every child process the attempt starts. */
  signal: AbortSignal;
}

export class StartupGate {
  private generation = 0;
  private controller = new AbortController();

  /** Token and signal for one start attempt. */
  begin(): StartupAttempt {
    return { token: this.generation, signal: this.controller.signal };
  }

  /**
   * Anything started before this call must no longer proceed: the token stops it
   * from continuing and the signal kills work already running.
   */
  cancel(): void {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}

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
