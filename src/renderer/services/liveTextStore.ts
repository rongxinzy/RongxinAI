/**
 * Cowork streaming — renderer live text store (apply UIMessageChunk increments).
 *
 * Flow: Pi delta → translator → coalescer → IPC StreamPart → rAF batcher → **this file** → AssistantBubble / ThinkingItem.
 * Holds partial assistant/thinking text outside Redux; applies text/reasoning deltas incrementally.
 *
 * Each message keeps a `base` (last authoritative snapshot, usually empty) plus ordered `parts`;
 * text = base + parts concatenated in insertion order. `setSnapshot` replaces the base and clears
 * parts — it is only for ContentPatch base sync (non-prefix rewrite / 2M truncation / gap resync).
 * Do not push full message bodies through IPC into this store on every token.
 *
 * **禁止**用全文覆盖模拟流式；**禁止**在 Redux 里 per-token 存整段 content。
 * Architecture: docs/architecture/streaming.md
 */
import type { UIMessageChunk } from 'ai';

import { CoworkRunPolicy } from '../../shared/cowork/runState';

type Listener = () => void;

type LiveTextEntry = {
  sessionId?: string;
  /** Last authoritative snapshot content (empty until a base snapshot lands). */
  base: string;
  /** Streaming part texts; Map insertion order is the concatenation order. */
  readonly parts: Map<string, string>;
  /** Cached `base + parts.join('')`, capped at MaximumContentCharacters. */
  text: string;
  /** True while waiting for a gap-resync base snapshot; increments are dropped. */
  awaitingBase: boolean;
};

/** B4: cap the store so stale streaming entries cannot accumulate forever. */
const MAX_ENTRIES = 256;

/** Transient streaming text outside Redux; committed on message finalize. */
export class LiveTextStore {
  private readonly entries = new Map<string, LiveTextEntry>();
  private readonly resyncingSessions = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private notifyScheduled = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(messageId: string): string | undefined {
    const entry = this.entries.get(messageId);
    // While a resync base snapshot is pending, the live text would be missing
    // its prefix; hide it so the UI falls back to the committed Redux content.
    if (!entry || entry.awaitingBase) return undefined;
    return entry.text;
  }

  setSnapshot(messageId: string, content: string, sessionId?: string): void {
    const entry = this.ensureEntry(messageId, sessionId);
    // A base snapshot replaces everything; parts restart empty so the next
    // delta cannot resurrect stale pre-gap part text over the new base.
    entry.base = this.truncate(content);
    entry.parts.clear();
    entry.awaitingBase = false;
    this.rebuildText(entry);
    this.scheduleNotify();
  }

  clear(messageId: string): void {
    if (this.entries.delete(messageId)) this.scheduleNotify();
  }

  resetSession(sessionId: string): void {
    this.resyncingSessions.add(sessionId);
    let touched = false;
    for (const entry of this.entries.values()) {
      if (entry.sessionId !== sessionId) continue;
      entry.base = '';
      entry.parts.clear();
      entry.text = '';
      entry.awaitingBase = true;
      touched = true;
    }
    if (touched) this.scheduleNotify();
  }

  endSessionResync(sessionId: string): void {
    this.resyncingSessions.delete(sessionId);
    let touched = false;
    for (const [messageId, entry] of this.entries) {
      if (entry.sessionId !== sessionId || !entry.awaitingBase) continue;
      // No base snapshot arrived: the message is no longer streaming, so its
      // display falls back to the committed Redux content.
      this.entries.delete(messageId);
      touched = true;
    }
    if (touched) this.scheduleNotify();
  }

  applyChunk(messageId: string, chunk: UIMessageChunk, sessionId?: string): void {
    const entry = this.ensureEntry(messageId, sessionId);
    // After a gap we wait for the resync base snapshot; increments would
    // otherwise render text that is missing its prefix.
    if (entry.awaitingBase) return;
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start':
        // Ensure the part exists; Map.set keeps the original insertion order
        // for known ids and appends new ids at the end.
        entry.parts.set(chunk.id, entry.parts.get(chunk.id) ?? '');
        break;
      case 'text-delta':
      case 'reasoning-delta':
        this.appendDelta(entry, chunk.id, chunk.delta);
        break;
      case 'text-end':
      case 'reasoning-end':
        break;
      default:
        break;
    }
  }

  private appendDelta(entry: LiveTextEntry, partId: string, delta: string): void {
    // The main process already truncates at the cap; this is a belt-and-braces
    // renderer bound — text is clipped to the cap and later deltas dropped.
    if (delta.length === 0 || entry.text.length >= CoworkRunPolicy.MaximumContentCharacters) return;
    const room = CoworkRunPolicy.MaximumContentCharacters - entry.text.length;
    const applied = delta.length > room ? delta.slice(0, room) : delta;
    const isNewPart = !entry.parts.has(partId);
    let lastPartId: string | undefined;
    for (const key of entry.parts.keys()) lastPartId = key;
    entry.parts.set(partId, (entry.parts.get(partId) ?? '') + applied);
    if (isNewPart || partId === lastPartId) {
      // Fast path: the delta extends the newest part (a brand-new part is
      // appended at the end), so the cached text just grows.
      entry.text += applied;
    } else {
      // A delta landed on an interleaved part; rebuild in insertion order.
      this.rebuildText(entry);
    }
    this.scheduleNotify();
  }

  private rebuildText(entry: LiveTextEntry): void {
    let text = entry.base;
    for (const part of entry.parts.values()) text += part;
    entry.text = this.truncate(text);
  }

  private truncate(content: string): string {
    return content.length > CoworkRunPolicy.MaximumContentCharacters
      ? content.slice(0, CoworkRunPolicy.MaximumContentCharacters)
      : content;
  }

  private ensureEntry(messageId: string, sessionId?: string): LiveTextEntry {
    const existing = this.entries.get(messageId);
    if (existing) {
      if (sessionId !== undefined) existing.sessionId = sessionId;
      return existing;
    }
    const entry: LiveTextEntry = {
      sessionId,
      base: '',
      parts: new Map<string, string>(),
      text: '',
      // Sessions awaiting a resync base snapshot drop live increments until
      // the snapshot lands (setSnapshot clears the flag).
      awaitingBase: sessionId !== undefined && this.resyncingSessions.has(sessionId),
    };
    this.entries.set(messageId, entry);
    if (this.evictOverflow()) this.scheduleNotify();
    return entry;
  }

  private evictOverflow(): boolean {
    let evicted = false;
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      evicted = true;
    }
    return evicted;
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}

export const coworkLiveTextStore = new LiveTextStore();
