import { getCoworkStreamMetadata } from './coworkStreamMetadata';
import { CoworkRunPolicy, type CoworkContentPatch } from '../shared/cowork/runState';
import { snapshotToContentPatches } from './piUiStreamGateway';

/**
 * Snapshot-only content patches for large messages (no prefix diff). Patches
 * ride the sequenced UiEvent stream; there is no side channel and no replay —
 * recovery reloads content through the session read. Only a per-message
 * length ledger is retained (for the memory bound), never the content.
 */
export class CoworkContentProjection {
  private revision = 0;
  private readonly lengths = new Map<string, number>();

  project(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<CoworkContentPatch[]> {
    metadata = getCoworkStreamMetadata(metadata);
    const visible = content.slice(0, CoworkRunPolicy.MaximumContentCharacters);
    const truncated = content.length > CoworkRunPolicy.MaximumContentCharacters;
    const revision = ++this.revision;
    this.lengths.set(messageId, visible.length);
    let characters = 0;
    for (const length of this.lengths.values()) characters += length;
    while (this.lengths.size > 256 || characters > 16_000_000) {
      const id = this.lengths.keys().next().value!;
      characters -= this.lengths.get(id)!;
      this.lengths.delete(id);
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
}
