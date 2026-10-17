import { getCoworkStreamMetadata } from './coworkStreamMetadata';
import { CoworkRunPolicy, type CoworkContentPatch } from '../shared/cowork/runState';
import { snapshotToContentPatches } from './piUiStreamGateway';

type Entry = {
  revision: number;
  content: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
  truncated: boolean;
};

/** Snapshot-only content patches for large messages and recovery (no prefix diff). */
export class CoworkContentProjection {
  private revision = 0;
  private readonly previous = new Map<string, Entry>();

  project(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
    _reset = false,
    latest = false,
  ): Promise<CoworkContentPatch[]> {
    metadata = getCoworkStreamMetadata(metadata);
    const previous = this.previous.get(messageId);
    if (latest && previous) {
      content = previous.content;
      metadata = previous.metadata;
    }
    const visible = content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
    const truncated =
      content.length > CoworkRunPolicy.MaximumContentCharacters ||
      Boolean(latest && previous?.truncated);
    const revision = ++this.revision;
    this.previous.set(messageId, {
      revision,
      content: visible,
      sessionId,
      metadata,
      truncated,
    });
    let characters = 0;
    for (const entry of this.previous.values()) characters += entry.content.length;
    while (this.previous.size > 256 || characters > 16_000_000) {
      const id = this.previous.keys().next().value!;
      characters -= this.previous.get(id)!.content.length;
      this.previous.delete(id);
    }
    return Promise.resolve(
      snapshotToContentPatches(
        sessionId,
        { messageId, content: visible, truncated },
        revision,
        metadata,
      ),
    );
  }

  async replay(sessionId: string): Promise<CoworkContentPatch[]> {
    const entries = [...this.previous.entries()].filter(
      ([, entry]) => entry.sessionId === sessionId,
    );
    const patches: CoworkContentPatch[] = [];
    for (const [id, entry] of entries) {
      patches.push(
        ...(await this.project(sessionId, id, entry.content, entry.metadata, true, true)),
      );
    }
    return patches;
  }

  has(messageId: string): boolean {
    return this.previous.has(messageId);
  }

  clear(sessionId: string): void {
    for (const [id, entry] of this.previous)
      if (entry.sessionId === sessionId) this.previous.delete(id);
  }
}
