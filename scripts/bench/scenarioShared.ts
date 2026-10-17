/**
 * Shared plumbing for the streaming bench: result schema, corpus, virtual feed
 * plan, latency tracking, throttle/Redux models, and result assembly.
 *
 * Conventions:
 * - 1 token = 4 UTF-16 code units (also documented in the JSON meta).
 * - Everything here consumes virtual time except the measure helpers and the
 *   wall-clock durations the VirtualClock reports per callback.
 */
import type { VirtualClock } from './virtualClock';

export type TokenKind = 'text' | 'reasoning';
export type BenchGroup = 'A' | 'C' | 'D';
export type BenchSize = '100kb' | '2mb';

export interface ScenarioConfig {
  readonly group: BenchGroup;
  readonly rate: number;
  readonly size: BenchSize;
  readonly thinking: boolean;
}

export interface RenderMetrics {
  readonly commits: number;
  readonly profilerAvailable: boolean;
  readonly profilerDurationSumMs: number;
  readonly profilerDurationP95Ms: number;
}

export interface ScenarioResult {
  readonly group: BenchGroup;
  readonly rate: number;
  readonly size: BenchSize;
  readonly thinking: boolean;
  readonly chars: number;
  readonly truncatedFrom: BenchSize | null;
  readonly virtualDurationMs: number;
  readonly ipcEvents: number;
  readonly ipcBytes: number;
  readonly bytesPerChar: number;
  readonly mainCpuMs: number;
  readonly workerCpuMs: number | null;
  readonly cpuMsPerVirtualSecond: number;
  readonly maxBlockingMs: number;
  readonly p99BlockingMs: number;
  readonly timerCallbacks: number;
  readonly sqliteWrites: number;
  readonly rendererCommits: number;
  readonly messageUpdateEmits: number | null;
  readonly e2eLatencyP50Ms: number;
  readonly e2eLatencyP95Ms: number;
  readonly e2eLatencySamples: number;
  readonly wallMs: number;
  readonly render: RenderMetrics | null;
  readonly notes: readonly string[];
}

export const FRAME_MS = 1000 / 60;
const TOKEN_CHARS = 4;
/** thinking/text alternate in blocks of 25 tokens (100 chars) within one message. */
const THINKING_BLOCK_TOKENS = 25;

const CORPUS =
  '混合 markdown：段落与 **bold**。\n\n```ts\nexport const x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nC:\\\\Users\\\\dev\\\\README.md\n';

export const sizeToChars = (size: BenchSize): number => (size === '2mb' ? 2_000_000 : 100_000);

export const buildCorpus = (chars: number): string => {
  let out = '';
  while (out.length < chars) out += CORPUS;
  return out.slice(0, chars);
};

interface FeedToken {
  readonly kind: TokenKind;
  readonly delta: string;
}

export interface FeedPlan {
  readonly intervalMs: number;
  readonly tokenCount: number;
  tokenAt(index: number): FeedToken;
}

/** Token i fires at virtual time i * intervalMs; kind alternates in blocks when thinking. */
export const createFeedPlan = (text: string, rate: number, thinking: boolean): FeedPlan => {
  const tokenCount = Math.floor(text.length / TOKEN_CHARS);
  const intervalMs = 1000 / Math.max(rate, 1);
  return {
    intervalMs,
    tokenCount,
    tokenAt: (index: number): FeedToken => {
      const start = index * TOKEN_CHARS;
      const delta = text.slice(start, start + TOKEN_CHARS);
      const kind: TokenKind =
        thinking && Math.floor(index / THINKING_BLOCK_TOKENS) % 2 === 1 ? 'reasoning' : 'text';
      return { kind, delta };
    },
  };
};

export const roundTo = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const percentileOfSorted = (sorted: readonly number[], percent: number): number => {
  if (sorted.length === 0) return 0;
  const rank = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)]!;
};

export const percentileOf = (values: readonly number[], percent: number): number =>
  percentileOfSorted(
    [...values].sort((left, right) => left - right),
    percent,
  );

/**
 * Per-stream end-to-end latency: deltas are recorded with their production
 * time; each frame reports how many chars of the stream are now visible, and
 * fully-covered deltas are sampled as (visibleAt - producedAt) virtual ms.
 */
export class StreamLatencyTracker {
  private readonly queue: { at: number; chars: number }[] = [];
  private head = 0;
  private consumedBefore = 0;
  private headConsumed = 0;
  private readonly samples: number[] = [];

  produce(at: number, chars: number): void {
    if (chars > 0) this.queue.push({ at, chars });
  }

  visible(cumulativeChars: number, atTime: number): void {
    while (this.head < this.queue.length) {
      const entry = this.queue[this.head]!;
      if (this.consumedBefore + this.headConsumed + entry.chars > cumulativeChars) break;
      this.consumedBefore += entry.chars;
      this.headConsumed = 0;
      this.head += 1;
      this.samples.push(atTime - entry.at);
    }
    const headEntry = this.queue[this.head];
    if (headEntry === undefined) {
      this.headConsumed = 0;
    } else {
      const partial = cumulativeChars - this.consumedBefore;
      this.headConsumed = Math.max(0, Math.min(partial, headEntry.chars));
    }
    this.compact();
  }

  sampleValues(): readonly number[] {
    return this.samples;
  }

  private compact(): void {
    if (this.head >= 4096 && this.head * 2 >= this.queue.length) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
  }
}

export interface LatencySummary {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly samples: number;
}

export const combineLatency = (trackers: readonly StreamLatencyTracker[]): LatencySummary => {
  const samples: number[] = [];
  for (const tracker of trackers) {
    for (const sample of tracker.sampleValues()) samples.push(sample);
  }
  return {
    p50Ms: percentileOf(samples, 50),
    p95Ms: percentileOf(samples, 95),
    samples: samples.length,
  };
};

export interface MeasureStart {
  readonly cpuUsage: NodeJS.CpuUsage;
  readonly hrtime: bigint;
}

interface MeasureResult {
  readonly cpuMs: number;
  readonly wallMs: number;
}

export const startMeasure = (): MeasureStart => ({
  cpuUsage: process.cpuUsage(),
  hrtime: process.hrtime.bigint(),
});

const finishMeasure = (start: MeasureStart): MeasureResult => {
  const usage = process.cpuUsage(start.cpuUsage);
  return {
    cpuMs: (usage.user + usage.system) / 1000,
    wallMs: Number(process.hrtime.bigint() - start.hrtime) / 1e6,
  };
};

export interface MockRedux {
  readonly commits: number;
  readonly text: string;
  dispatch(text: string): void;
}

/** Phase-1 renderer model: the accumulated streaming text lands in "Redux" once per rAF frame. */
export const createMockRedux = (): MockRedux => {
  let commits = 0;
  let text = '';
  return {
    get commits(): number {
      return commits;
    },
    get text(): string {
      return text;
    },
    dispatch(next: string): void {
      text = next;
      commits += 1;
    },
  };
};

/**
 * Counts transcript store.updateMessage writes under the same 200 ms
 * leading+trailing throttle the legacy transcript used; applied to A (copied
 * legacy throttles live in the fixture) and to C/D as the persistence model.
 */
export class ThrottledSqliteCounter {
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private trailingArmed = false;
  private writes = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly intervalMs = 200,
  ) {}

  onDelta(): void {
    const now = this.clock.now();
    if (now - this.lastWriteAt >= this.intervalMs) {
      this.lastWriteAt = now;
      this.writes += 1;
      return;
    }
    if (this.trailingArmed) return;
    this.trailingArmed = true;
    this.clock.setTimeout(
      () => {
        this.trailingArmed = false;
        this.lastWriteAt = this.clock.now();
        this.writes += 1;
      },
      this.intervalMs - (now - this.lastWriteAt),
    );
  }

  /** Finalization always persists the final snapshot once. */
  flushFinal(): void {
    this.writes += 1;
  }

  get writeCount(): number {
    return this.writes;
  }
}

export interface ResultPieces {
  readonly config: ScenarioConfig;
  readonly chars: number;
  readonly truncatedFrom: BenchSize | null;
  readonly clock: VirtualClock;
  readonly blocking: readonly number[];
  readonly ipcEvents: number;
  readonly ipcBytes: number;
  readonly workerCpuMs: number | null;
  readonly sqliteWrites: number;
  readonly rendererCommits: number;
  readonly messageUpdateEmits: number | null;
  readonly latency: LatencySummary;
  readonly measure: MeasureStart;
  readonly render: RenderMetrics | null;
  readonly notes: string[];
}

export const assembleResult = (pieces: ResultPieces): ScenarioResult => {
  const usage = finishMeasure(pieces.measure);
  const blocking = [...pieces.blocking].sort((left, right) => left - right);
  const virtualSeconds = Math.max(pieces.clock.now() / 1000, 1e-9);
  return {
    group: pieces.config.group,
    rate: pieces.config.rate,
    size: pieces.config.size,
    thinking: pieces.config.thinking,
    chars: pieces.chars,
    truncatedFrom: pieces.truncatedFrom,
    virtualDurationMs: roundTo(pieces.clock.now()),
    ipcEvents: pieces.ipcEvents,
    ipcBytes: pieces.ipcBytes,
    bytesPerChar: roundTo(pieces.ipcBytes / Math.max(pieces.chars, 1), 6),
    mainCpuMs: roundTo(usage.cpuMs),
    workerCpuMs: pieces.workerCpuMs === null ? null : roundTo(pieces.workerCpuMs),
    cpuMsPerVirtualSecond: roundTo(usage.cpuMs / virtualSeconds),
    maxBlockingMs: roundTo(blocking.length > 0 ? blocking[blocking.length - 1]! : 0),
    p99BlockingMs: roundTo(percentileOfSorted(blocking, 99)),
    timerCallbacks: pieces.clock.callbackCount,
    sqliteWrites: pieces.sqliteWrites,
    rendererCommits: pieces.rendererCommits,
    messageUpdateEmits: pieces.messageUpdateEmits,
    e2eLatencyP50Ms: roundTo(pieces.latency.p50Ms),
    e2eLatencyP95Ms: roundTo(pieces.latency.p95Ms),
    e2eLatencySamples: pieces.latency.samples,
    wallMs: roundTo(usage.wallMs),
    render: pieces.render,
    notes: pieces.notes,
  };
};
