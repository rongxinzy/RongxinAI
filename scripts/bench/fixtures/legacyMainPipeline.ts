/**
 * Group A fixture — the pre-#1119 Cowork streaming path on main.
 *
 * Copied from main@aa288943 (minimal bench surface only: no worker pool, no
 * replay, no bounded cache trimming, no metadata shaping):
 *   - src/main/piAssistantTranscript.ts — per-token full-text accumulation,
 *     the 200 ms leading+trailing messageUpdate throttle and the matching
 *     store.updateMessage throttle (Date.now + global setTimeout).
 *   - src/main/textWorkerOperations.ts — the TextWorkerKind.Content branch:
 *     the `startsWith` prefix diff. It ran inside the shared text worker on
 *     main; here it runs inline and its wall time is accumulated separately
 *     as workerCpuMs.
 *   - src/main/coworkContentProjection.ts — revision bump, previous-content
 *     cache and CoworkContentPatch chunking.
 *
 * Must run inside installVirtualGlobals(...) so its Date.now/setTimeout/
 * clearTimeout land on the bench's virtual clock.
 */
import { CoworkRunPolicy, type CoworkContentPatch } from '../../../src/shared/cowork/runState';

const MESSAGE_UPDATE_THROTTLE_MS = 200;
const STORE_UPDATE_THROTTLE_MS = 200;

const LEGACY_ANSWER_MESSAGE_ID = 'bench-legacy-answer';
export const LEGACY_THINKING_MESSAGE_ID = 'bench-legacy-thinking';

export type LegacyMessageKind = 'answer' | 'thinking';

type Timeout = ReturnType<typeof setTimeout>;

interface LegacyMessageState {
  readonly messageId: string;
  content: string;
  // Date.now() on main is epoch-ms, so a fresh message always takes the
  // leading path on its first update; -Infinity reproduces that under a
  // virtual clock that starts at t=0.
  lastEmitAt: number;
  emitTimer: Timeout | undefined;
  pendingEmit: string | undefined;
  lastWriteAt: number;
  writeTimer: Timeout | undefined;
}

/** main@aa288943 textWorkerOperations.ts, Content branch. */
interface LegacyDiffResult {
  readonly content: string;
  readonly offset: number;
  readonly truncated: boolean;
}

const runLegacyContentDiff = (
  content: string,
  previous: string,
  reset: boolean,
): LegacyDiffResult => {
  const capped = content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
  const offset = !reset && capped.startsWith(previous) ? previous.length : 0;
  return {
    content: capped.slice(offset),
    offset,
    truncated: capped.length < content.length,
  };
};

/** main@aa288943 coworkContentProjection.ts with the worker call inlined and timed. */
class LegacyContentProjection {
  private revision = 0;
  private readonly previous = new Map<string, { revision: number; content: string }>();
  private workerCpuNs = 0n;

  project(sessionId: string, messageId: string, content: string): CoworkContentPatch[] {
    const previous = this.previous.get(messageId);
    const started = process.hrtime.bigint();
    const result = runLegacyContentDiff(content, previous?.content ?? '', false);
    this.workerCpuNs += process.hrtime.bigint() - started;
    const visible = content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
    const revision = ++this.revision;
    this.previous.set(messageId, { revision, content: visible });
    const patches: CoworkContentPatch[] = [];
    let cursor = 0;
    do {
      const end = Math.min(result.content.length, cursor + CoworkRunPolicy.ContentChunkCharacters);
      patches.push({
        sessionId,
        messageId,
        revision,
        baseRevision: result.offset > 0 ? (previous?.revision ?? 0) : 0,
        offset: result.offset + cursor,
        content: result.content.slice(cursor, end),
        totalLength: visible.length,
        complete: end === result.content.length,
        truncated: result.truncated,
        ...(end === result.content.length ? { metadata: { isStreaming: true } } : {}),
      });
      cursor = end;
    } while (cursor < result.content.length);
    return patches;
  }

  get workerCpuMs(): number {
    return Number(this.workerCpuNs) / 1e6;
  }
}

export interface LegacyPipelineCallbacks {
  /** One ContentPatch leaving the main process over IPC. */
  readonly onPatch: (patch: CoworkContentPatch) => void;
}

/** transcript throttling + projection, wired end to end for the bench. */
export class LegacyMainPipeline {
  private readonly projection = new LegacyContentProjection();
  private readonly messages = new Map<LegacyMessageKind, LegacyMessageState>();
  private emitCount = 0;
  sqliteWrites = 0;

  constructor(private readonly callbacks: LegacyPipelineCallbacks) {}

  get workerCpuMs(): number {
    return this.projection.workerCpuMs;
  }

  get messageUpdateEmits(): number {
    return this.emitCount;
  }

  /** transcript.streamInto: accumulate the full snapshot, then run both throttles. */
  streamInto(kind: LegacyMessageKind, delta: string): void {
    const message = this.ensureMessage(kind);
    message.content += delta;
    this.throttledStoreUpdate(message);
    this.throttledEmitMessageUpdate(message);
  }

  /** transcript.finalizeMessage: flush throttles, persist and emit the final snapshot. */
  finalize(kind: LegacyMessageKind): void {
    const message = this.messages.get(kind);
    if (message === undefined) return;
    this.clearEmitTimer(message);
    message.pendingEmit = undefined;
    this.emitUpdate(message, message.content);
    this.clearWriteTimer(message);
    message.lastWriteAt = Date.now();
    this.sqliteWrites += 1;
  }

  private ensureMessage(kind: LegacyMessageKind): LegacyMessageState {
    const existing = this.messages.get(kind);
    if (existing !== undefined) return existing;
    const message: LegacyMessageState = {
      messageId: kind === 'thinking' ? LEGACY_THINKING_MESSAGE_ID : LEGACY_ANSWER_MESSAGE_ID,
      content: '',
      lastEmitAt: Number.NEGATIVE_INFINITY,
      emitTimer: undefined,
      pendingEmit: undefined,
      lastWriteAt: Number.NEGATIVE_INFINITY,
      writeTimer: undefined,
    };
    this.messages.set(kind, message);
    return message;
  }

  private emitUpdate(message: LegacyMessageState, content: string): void {
    message.lastEmitAt = Date.now();
    this.emitCount += 1;
    const patches = this.projection.project('bench-session', message.messageId, content);
    for (const patch of patches) this.callbacks.onPatch(patch);
  }

  // ── 200 ms leading+trailing throttles (copied behavior) ──

  private throttledEmitMessageUpdate(message: LegacyMessageState): void {
    const now = Date.now();
    const elapsed = now - message.lastEmitAt;
    if (elapsed >= MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearEmitTimer(message);
      this.emitUpdate(message, message.content);
      return;
    }
    message.pendingEmit = message.content;
    if (message.emitTimer !== undefined) return;
    message.emitTimer = setTimeout(() => {
      message.emitTimer = undefined;
      const pending = message.pendingEmit;
      message.pendingEmit = undefined;
      if (pending !== undefined) this.emitUpdate(message, pending);
    }, MESSAGE_UPDATE_THROTTLE_MS - elapsed);
  }

  private clearEmitTimer(message: LegacyMessageState): void {
    if (message.emitTimer !== undefined) {
      clearTimeout(message.emitTimer);
      message.emitTimer = undefined;
    }
  }

  private throttledStoreUpdate(message: LegacyMessageState): void {
    const now = Date.now();
    const elapsed = now - message.lastWriteAt;
    if (elapsed >= STORE_UPDATE_THROTTLE_MS) {
      this.clearWriteTimer(message);
      message.lastWriteAt = now;
      this.sqliteWrites += 1;
      return;
    }
    if (message.writeTimer !== undefined) return;
    message.writeTimer = setTimeout(() => {
      message.writeTimer = undefined;
      message.lastWriteAt = Date.now();
      this.sqliteWrites += 1;
    }, STORE_UPDATE_THROTTLE_MS - elapsed);
  }

  private clearWriteTimer(message: LegacyMessageState): void {
    if (message.writeTimer !== undefined) {
      clearTimeout(message.writeTimer);
      message.writeTimer = undefined;
    }
  }
}
