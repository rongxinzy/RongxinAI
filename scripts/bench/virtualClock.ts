/**
 * Deterministic virtual clock for the streaming bench.
 *
 * The bench never sleeps: a 2 MB stream at 50 tokens/s spans hours of wall
 * time, so every timer in the pipeline under test — the Pi token feeder, the
 * coalescer's 16/32 ms windows, the 200 ms transcript throttles and the
 * 16.67 ms virtual rAF frames — is scheduled on this clock and fired by
 * advancing virtual time. Callback order matches a real event loop: by due
 * time, then by insertion order.
 *
 * installVirtualGlobals() swaps globalThis setTimeout/clearTimeout/Date.now/
 * performance.now (and queueMicrotask) for virtual implementations while a
 * scenario runs, because production classes such as UiMessageChunkCoalescer
 * call the globals directly (it uses global setTimeout + performance.now; the
 * copied legacy transcript uses Date.now + setTimeout). Originals are saved
 * with their own types and restored afterwards.
 */
export class VirtualTimer {
  public canceled = false;

  constructor(
    public readonly id: number,
    public readonly dueAt: number,
    public readonly insertion: number,
    public readonly run: () => void,
  ) {}
}

export type VirtualTimeoutHandle = VirtualTimer;

export interface VirtualClockOptions {
  /** Invoked with the real (wall-clock) nanoseconds each timer callback took. */
  readonly onCallbackDuration?: (realNs: number) => void;
}

export class VirtualClock {
  private currentTime = 0;
  private nextTimerId = 1;
  private nextInsertion = 0;
  private executedCallbacks = 0;
  private readonly heap: VirtualTimer[] = [];
  private readonly observeDuration: ((realNs: number) => void) | undefined;

  constructor(options: VirtualClockOptions = {}) {
    this.observeDuration = options.onCallbackDuration;
  }

  now(): number {
    return this.currentTime;
  }

  get timerCount(): number {
    return this.heap.length;
  }

  get callbackCount(): number {
    return this.executedCallbacks;
  }

  setTimeout(callback: () => void, ms: number): VirtualTimeoutHandle {
    const timer = new VirtualTimer(
      this.nextTimerId,
      this.currentTime + Math.max(ms, 0),
      this.nextInsertion,
      callback,
    );
    this.nextTimerId += 1;
    this.nextInsertion += 1;
    this.insert(timer);
    return timer;
  }

  clearTimeout(handle: VirtualTimeoutHandle): void {
    handle.canceled = true;
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.currentTime + ms);
  }

  advanceTo(target: number): void {
    if (target < this.currentTime) return;
    for (;;) {
      const timer = this.heap[0];
      if (timer === undefined || timer.dueAt > target) break;
      this.currentTime = timer.dueAt;
      this.removeRoot();
      if (timer.canceled) continue;
      this.executedCallbacks += 1;
      if (this.observeDuration === undefined) {
        timer.run();
        continue;
      }
      const started = process.hrtime.bigint();
      try {
        timer.run();
      } finally {
        this.observeDuration(Number(process.hrtime.bigint() - started));
      }
    }
    if (target > this.currentTime) this.currentTime = target;
  }

  /** Fires every pending timer, including ones armed by callbacks, until the queue empties. */
  drain(maxCallbacks = 5_000_000): void {
    while (this.executedCallbacks < maxCallbacks) {
      const next = this.heap[0];
      if (next === undefined) return;
      this.advanceTo(next.dueAt);
      if (this.heap.length === 0) return;
    }
  }

  // ── min-heap keyed by (dueAt, insertion) ──

  private insert(timer: VirtualTimer): void {
    this.heap.push(timer);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.precedes(this.heap[parent]!, timer)) break;
      this.heap[index] = this.heap[parent]!;
      this.heap[parent] = timer;
      index = parent;
    }
  }

  private removeRoot(): void {
    const last = this.heap.pop();
    if (last === undefined || this.heap.length === 0) return;
    this.heap[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.heap.length && this.precedes(this.heap[left]!, this.heap[smallest]!)) {
        smallest = left;
      }
      if (right < this.heap.length && this.precedes(this.heap[right]!, this.heap[smallest]!)) {
        smallest = right;
      }
      if (smallest === index) return;
      const swapped = this.heap[smallest]!;
      this.heap[smallest] = this.heap[index]!;
      this.heap[index] = swapped;
      index = smallest;
    }
  }

  private precedes(left: VirtualTimer, right: VirtualTimer): boolean {
    return (
      left.dueAt < right.dueAt || (left.dueAt === right.dueAt && left.insertion < right.insertion)
    );
  }
}

type GlobalSetTimeout = typeof globalThis.setTimeout;
type GlobalClearTimeout = typeof globalThis.clearTimeout;
type GlobalQueueMicrotask = typeof globalThis.queueMicrotask;
type TimerHandlerLike = (() => void) | ((...args: unknown[]) => void) | string;

interface SavedVirtualGlobals {
  readonly setTimeout: GlobalSetTimeout;
  readonly clearTimeout: GlobalClearTimeout;
  readonly dateNow: typeof Date.now;
  readonly performanceNow: typeof performance.now;
  readonly queueMicrotask: GlobalQueueMicrotask;
}

/**
 * Swaps the global timer/clock entry points for virtual-clock versions while a
 * scenario runs and returns a restore function. Only function handlers are
 * supported (nothing in the pipeline schedules string handlers).
 *
 * queueMicrotask is also inlined: LiveTextStore notifies subscribers through a
 * microtask, and the virtual clock never yields between callbacks, so running
 * it inline keeps renderer bookkeeping (and the optional React flush) inside
 * the measured frame callback instead of after the whole virtual run.
 */
export const installVirtualGlobals = (clock: VirtualClock): (() => void) => {
  const saved: SavedVirtualGlobals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
    performanceNow: performance.now,
    queueMicrotask: globalThis.queueMicrotask,
  };

  const virtualSetTimeout = ((
    handler: TimerHandlerLike,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<GlobalSetTimeout> => {
    if (typeof handler !== 'function') {
      throw new Error('virtual setTimeout only supports function handlers');
    }
    const callback = handler as (...handlerArgs: unknown[]) => void;
    const timer = clock.setTimeout(() => {
      callback(...args);
    }, timeout ?? 0);
    return timer as unknown as ReturnType<GlobalSetTimeout>;
  }) as unknown as GlobalSetTimeout;

  const virtualClearTimeout = ((handle?: unknown): void => {
    if (handle instanceof VirtualTimer) clock.clearTimeout(handle);
  }) as unknown as GlobalClearTimeout;

  globalThis.setTimeout = virtualSetTimeout;
  globalThis.clearTimeout = virtualClearTimeout;
  Date.now = (): number => Math.round(clock.now());
  performance.now = (): number => clock.now();
  globalThis.queueMicrotask = (callback: () => void): void => {
    callback();
  };

  let restored = false;
  return (): void => {
    if (restored) return;
    restored = true;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
    Date.now = saved.dateNow;
    performance.now = saved.performanceNow;
    globalThis.queueMicrotask = saved.queueMicrotask;
  };
};

/** rAF-style scheduler on the virtual clock: frames every frameMs, aligned from t=0. */
export const createVirtualRafScheduler = (clock: VirtualClock, frameMs = 1000 / 60) => {
  let nextFrameId = 1;
  const armed = new Map<number, VirtualTimer>();
  return {
    request: (callback: () => void): number => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      const dueAt = Math.floor(clock.now() / frameMs) * frameMs + frameMs;
      const timer = clock.setTimeout(() => {
        armed.delete(frameId);
        callback();
      }, dueAt - clock.now());
      armed.set(frameId, timer);
      return frameId;
    },
    cancel: (frameId: number): void => {
      const timer = armed.get(frameId);
      if (timer === undefined) return;
      clock.clearTimeout(timer);
      armed.delete(frameId);
    },
  };
};
