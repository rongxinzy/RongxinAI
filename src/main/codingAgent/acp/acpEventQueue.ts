export const AcpEventQueueLimits = {
  MaxEvents: 2048,
  MaxBytes: 8 * 1024 * 1024,
} as const;

type QueueEvent = {
  kind: string;
  payload: Record<string, unknown>;
};

type QueueEntry<T> = {
  event: T;
  bytes: number;
};

export type AcpEventQueueEnqueueResult<T> = {
  accepted: boolean;
  event: T;
  replaced?: T;
};

const estimateBytes = (value: unknown, budget = AcpEventQueueLimits.MaxBytes): number => {
  let remaining = budget;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): number => {
    if (remaining <= 0) return 0;
    if (typeof candidate === 'string') {
      const bytes = Math.min(candidate.length * 2, remaining);
      remaining -= bytes;
      return bytes;
    }
    if (candidate === null || typeof candidate !== 'object') return 8;
    if (seen.has(candidate)) return 0;
    seen.add(candidate);
    let bytes = 16;
    for (const [key, child] of Object.entries(candidate)) {
      bytes += key.length * 2 + visit(child);
      if (remaining <= 0) break;
    }
    return bytes;
  };
  return visit(value);
};

export class AcpEventQueue<T extends QueueEvent> {
  private readonly entries: Array<QueueEntry<T>> = [];
  private bytes = 0;

  constructor(private readonly mergeAdjacent?: (previous: T, next: T) => T | null) {}

  enqueue(event: T): AcpEventQueueEnqueueResult<T> {
    const last = this.entries.at(-1);
    const merged = last && this.mergeAdjacent?.(last.event, event);
    if (merged) {
      const mergedBytes = estimateBytes(merged);
      const nextBytes = this.bytes - last.bytes + mergedBytes;
      if (nextBytes <= AcpEventQueueLimits.MaxBytes) {
        this.entries[this.entries.length - 1] = { event: merged, bytes: mergedBytes };
        this.bytes = nextBytes;
        return { accepted: true, event: merged, replaced: last.event };
      }
    }

    const eventBytes = estimateBytes(event);
    if (
      this.entries.length >= AcpEventQueueLimits.MaxEvents ||
      this.bytes + eventBytes > AcpEventQueueLimits.MaxBytes
    ) {
      return { accepted: false, event };
    }
    this.entries.push({ event, bytes: eventBytes });
    this.bytes += eventBytes;
    return { accepted: true, event };
  }

  dequeue(): T | undefined {
    const entry = this.entries.shift();
    if (!entry) return undefined;
    this.bytes = Math.max(0, this.bytes - entry.bytes);
    return entry.event;
  }

  get length(): number {
    return this.entries.length;
  }

  get byteLength(): number {
    return this.bytes;
  }
}
