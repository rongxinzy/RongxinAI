/**
 * Cowork streaming — renderer live text entry (apply UIMessageChunk increments).
 *
 * Flow: Pi delta → translator → coalescer → IPC StreamPart → **this file** → StreamingMarkdownResponse.
 * Holds partial assistant text outside Redux; applies text/reasoning deltas incrementally.
 *
 * Invariants: `applyChunk` only extends part text by delta; `setSnapshot` is for ContentPatch recovery/finalize sync.
 * Do not push full message bodies through IPC into this store on every token.
 *
 * **禁止**用全文覆盖模拟流式；**禁止**在 Redux 里 per-token 存整段 content。
 * Architecture: docs/architecture/streaming.md
 */
import type { UIMessageChunk } from 'ai';

type Listener = () => void;

/** Transient streaming text outside Redux; committed on message finalize. */
export class LiveTextStore {
  private readonly textByMessage = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private readonly partText = new Map<string, string>();
  private notifyScheduled = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(messageId: string): string | undefined {
    return this.textByMessage.get(messageId);
  }

  setSnapshot(messageId: string, content: string): void {
    this.textByMessage.set(messageId, content);
    this.scheduleNotify();
  }

  clear(messageId: string): void {
    this.textByMessage.delete(messageId);
    for (const key of [...this.partText.keys()]) {
      if (key.startsWith(`${messageId}:`)) this.partText.delete(key);
    }
    this.scheduleNotify();
  }

  applyChunk(messageId: string, chunk: UIMessageChunk): void {
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start':
        this.partText.set(`${messageId}:${chunk.id}`, '');
        break;
      case 'text-delta':
      case 'reasoning-delta': {
        const key = `${messageId}:${chunk.id}`;
        const next = (this.partText.get(key) ?? '') + chunk.delta;
        this.partText.set(key, next);
        this.rebuildMessage(messageId);
        break;
      }
      case 'text-end':
      case 'reasoning-end':
        this.rebuildMessage(messageId);
        break;
      default:
        break;
    }
  }

  private rebuildMessage(messageId: string): void {
    const parts = [...this.partText.entries()]
      .filter(([key]) => key.startsWith(`${messageId}:`))
      .sort(([left], [right]) => left.localeCompare(right));
    const content = parts.map(([, value]) => value).join('');
    this.textByMessage.set(messageId, content);
    this.scheduleNotify();
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
