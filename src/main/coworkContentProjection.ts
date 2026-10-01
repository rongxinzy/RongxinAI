import { getCoworkStreamMetadata } from './coworkStreamMetadata';
import { CoworkRunPolicy, type CoworkContentPatch } from '../shared/cowork/runState';
import { transformCoworkTextAsync } from './workbenchTask/artifactWorkerPool';
import {
  TextWorkerKind,
  type TextWorkerInput,
  type TextWorkerOutput,
} from './workbenchTask/textWorkerOperations';

type Entry = {
  revision: number;
  content: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
  truncated: boolean;
};

/** Ordering and cache ownership stay on main; full-prefix comparison runs in the shared worker pool. */
export class CoworkContentProjection {
  private revision = 0;
  private readonly previous = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<CoworkContentPatch[]>>();
  constructor(
    private readonly transform: (
      input: TextWorkerInput,
    ) => Promise<TextWorkerOutput> = transformCoworkTextAsync,
  ) {}

  project(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
    reset = false,
    latest = false,
  ): Promise<CoworkContentPatch[]> {
    metadata = getCoworkStreamMetadata(metadata);
    const prior = this.pending.get(messageId);
    const task = (prior ? prior.catch((): CoworkContentPatch[] => []) : Promise.resolve()).then(
      async () => {
        const previous = this.previous.get(messageId);
        if (latest && previous) {
          content = previous.content;
          metadata = previous.metadata;
        }
        const truncated =
          content.length > CoworkRunPolicy.MaximumContentCharacters ||
          Boolean(latest && previous?.truncated);
        const result = await this.transform({
          kind: TextWorkerKind.Content,
          content: content.slice(0, CoworkRunPolicy.MaximumContentCharacters + 1),
          previous: previous?.content ?? '',
          reset,
        });
        const visible = content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
        const revision = ++this.revision;
        this.previous.delete(messageId);
        this.previous.set(messageId, {
          revision,
          content: visible,
          sessionId,
          metadata,
          truncated,
        });
        // A bounded tail cache: historical content is replayed from SQLite on recovery.
        let characters = 0;
        for (const entry of this.previous.values()) characters += entry.content.length;
        while (this.previous.size > 256 || characters > 16_000_000) {
          const id = this.previous.keys().next().value!;
          characters -= this.previous.get(id)!.content.length;
          this.previous.delete(id);
        }
        const patches: CoworkContentPatch[] = [];
        let cursor = 0;
        do {
          const end = Math.min(
            result.content.length,
            cursor + CoworkRunPolicy.ContentChunkCharacters,
          );
          patches.push({
            sessionId,
            messageId,
            revision,
            baseRevision: result.offset > 0 ? (previous?.revision ?? 0) : 0,
            offset: result.offset + cursor,
            content: result.content.slice(cursor, end),
            totalLength: visible.length,
            complete: end === result.content.length,
            truncated,
            ...(end === result.content.length && { metadata }),
          });
          cursor = end;
        } while (cursor < result.content.length);
        return patches;
      },
    );
    this.pending.set(messageId, task);
    void task
      .finally(() => {
        if (this.pending.get(messageId) === task) this.pending.delete(messageId);
      })
      .catch(() => {});
    return task;
  }

  async replay(sessionId: string): Promise<CoworkContentPatch[]> {
    await Promise.allSettled([...this.pending.values()]);
    const entries = [...this.previous.entries()].filter(
      ([, entry]) => entry.sessionId === sessionId,
    );
    const patches: CoworkContentPatch[] = [];
    for (const [id, entry] of entries) {
      const frames = await this.project(sessionId, id, entry.content, entry.metadata, true, true);
      patches.push(...frames);
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
