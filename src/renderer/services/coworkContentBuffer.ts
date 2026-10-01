import { CoworkRunPolicy, type CoworkContentPatch } from '../../shared/cowork/runState';
import type { StreamMessageUpdate } from './rafMessageUpdateBatcher';

type Entry = {
  revision: number;
  content: string;
  complete: boolean;
  sessionId: string;
  metadata?: Record<string, unknown>;
};

export class CoworkContentBuffer {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly onGap: (sessionId: string) => void) {}

  apply(patch: CoworkContentPatch): StreamMessageUpdate | null {
    if (
      !Number.isSafeInteger(patch.revision) ||
      patch.revision < 1 ||
      !Number.isSafeInteger(patch.totalLength) ||
      patch.totalLength < 0 ||
      !Number.isSafeInteger(patch.offset) ||
      patch.offset < 0 ||
      patch.content.length > CoworkRunPolicy.ContentChunkCharacters ||
      patch.totalLength > CoworkRunPolicy.MaximumContentCharacters
    )
      return null;
    const previous = this.entries.get(patch.messageId);
    if (previous && patch.revision < previous.revision) return null;
    if (
      previous &&
      patch.revision === previous.revision &&
      (previous.complete || patch.offset < previous.content.length)
    )
      return null;
    if (
      patch.offset > 0 &&
      patch.revision !== previous?.revision &&
      patch.baseRevision !== previous?.revision
    ) {
      this.onGap(patch.sessionId);
      return null;
    }
    const base = patch.offset === 0 ? '' : previous?.content;
    if (base === undefined || base.length !== patch.offset) {
      this.onGap(patch.sessionId);
      return null;
    }
    const content = base + patch.content;
    if (
      content.length > patch.totalLength ||
      (patch.complete && content.length !== patch.totalLength)
    )
      return null;
    this.entries.set(patch.messageId, {
      revision: patch.revision,
      content,
      complete: patch.complete,
      sessionId: patch.sessionId,
      metadata: patch.metadata,
    });
    let characters = 0;
    for (const entry of this.entries.values()) characters += entry.content.length;
    while (this.entries.size > 256 || characters > 16_000_000) {
      const id = this.entries.keys().next().value!;
      characters -= this.entries.get(id)!.content.length;
      this.entries.delete(id);
    }
    return patch.complete
      ? {
          sessionId: patch.sessionId,
          messageId: patch.messageId,
          content,
          metadata: { ...patch.metadata, contentTruncated: patch.truncated },
        }
      : null;
  }

  clear(sessionId: string): void {
    for (const [id, entry] of this.entries)
      if (entry.sessionId === sessionId) this.entries.delete(id);
  }

  latest(messageId: string): string | undefined {
    const entry = this.entries.get(messageId);
    return entry?.complete ? entry.content : undefined;
  }
}
