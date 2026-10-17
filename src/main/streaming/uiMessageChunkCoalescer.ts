/**
 * Cowork streaming — coalescer entry (single upstream merge before IPC).
 *
 * Flow: Pi delta → translator → **this file** → sequencer → IPC → LiveTextStore → StreamingMarkdownResponse.
 * Merges consecutive deltas for the same stream part within time/size bounds; emits non-delta chunks immediately.
 *
 * Invariants: only this coalescer may batch outbound stream parts; renderer owns the sole display throttle.
 * Snapshots are not produced here — forwarder emits ContentPatch only on exceptional paths.
 *
 * History: re-adding a second merge/throttle (e.g. 200 ms full messageUpdate, 1915c318 / #1115) regresses to O(N²) IPC.
 *
 * **禁止**在 coalescer 外再合并/节流；**禁止**先累积全文再 diff；**禁止**IPC 常规推送全文快照。
 *
 * Algorithm inspired by the CherryHQ/cherry-studio WebContentsListener design (AGPL-3.0); this code is an independent implementation and copies no code.
 * Architecture: docs/architecture/streaming.md
 */
import type { UIMessageChunk } from 'ai';

import { StreamCoalesceLimits } from './streamLimits';

type CoalescableChunk =
  | Extract<UIMessageChunk, { type: 'text-delta' }>
  | Extract<UIMessageChunk, { type: 'reasoning-delta' }>
  | Extract<UIMessageChunk, { type: 'tool-input-delta' }>;

type PendingDelta = {
  key: string;
  chunk: CoalescableChunk;
  startedAt: number;
};

export type UiMessageChunkEmitContext = {
  sessionId: string;
  messageId: string;
  chunk: UIMessageChunk;
};

const isCoalescable = (chunk: UIMessageChunk): chunk is CoalescableChunk => {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return !('providerMetadata' in chunk) || chunk.providerMetadata === undefined;
  }
  return chunk.type === 'tool-input-delta';
};

const deltaKey = (sessionId: string, messageId: string, chunk: CoalescableChunk): string => {
  if (chunk.type === 'tool-input-delta') {
    return `${sessionId}:${messageId}:tool:${chunk.toolCallId}`;
  }
  return `${sessionId}:${messageId}:${chunk.type}:${chunk.id}`;
};

const mergeDelta = (target: CoalescableChunk, incoming: CoalescableChunk): CoalescableChunk => {
  if (target.type === 'text-delta' && incoming.type === 'text-delta') {
    return { ...target, delta: target.delta + incoming.delta };
  }
  if (target.type === 'reasoning-delta' && incoming.type === 'reasoning-delta') {
    return { ...target, delta: target.delta + incoming.delta };
  }
  if (target.type === 'tool-input-delta' && incoming.type === 'tool-input-delta') {
    return {
      ...target,
      inputTextDelta: target.inputTextDelta + incoming.inputTextDelta,
    };
  }
  return incoming;
};

const deltaLength = (chunk: CoalescableChunk): number => {
  if (chunk.type === 'tool-input-delta') return chunk.inputTextDelta.length;
  return chunk.delta.length;
};

/** Coalesces consecutive UI message deltas before IPC sequencing. */
export class UiMessageChunkCoalescer {
  private pending: (PendingDelta & { sessionId: string; messageId: string }) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly emit: (payload: UiMessageChunkEmitContext) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  push(sessionId: string, messageId: string, chunk: UIMessageChunk): void {
    if (!isCoalescable(chunk)) {
      this.flush();
      this.emit({ sessionId, messageId, chunk });
      return;
    }
    const key = deltaKey(sessionId, messageId, chunk);
    const startedAt = this.now();
    if (this.pending && this.pending.key === key) {
      this.pending.chunk = mergeDelta(this.pending.chunk, chunk);
      if (
        this.now() - this.pending.startedAt >= StreamCoalesceLimits.MaxAgeMs ||
        deltaLength(this.pending.chunk) >= StreamCoalesceLimits.MaxChars
      ) {
        this.flushPending();
      }
      return;
    }
    this.flushPending();
    this.pending = { key, sessionId, messageId, chunk: { ...chunk }, startedAt };
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flushPending();
    }, StreamCoalesceLimits.WindowMs);
  }

  flush(): void {
    this.flushPending();
  }

  dispose(): void {
    this.flush();
  }

  private flushPending(): void {
    // The timer must die with the pending entry: a size/age-triggered or
    // external flush already emitted it, and a late timer firing into an
    // empty slot would be a stray wakeup (N1).
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.pending) return;
    const { sessionId, messageId, chunk } = this.pending;
    this.emit({ sessionId, messageId, chunk });
    this.pending = null;
  }
}
