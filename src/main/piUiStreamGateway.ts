import { CoworkRunPolicy, type CoworkContentPatch } from '../shared/cowork/runState';
export type PiUiStreamMessageSnapshot = {
  messageId: string;
  content: string;
  truncated: boolean;
};

export const snapshotToContentPatches = (
  sessionId: string,
  snapshot: PiUiStreamMessageSnapshot,
  revision: number,
  metadata?: Record<string, unknown>,
): CoworkContentPatch[] => {
  const visible = snapshot.content;
  const patches: CoworkContentPatch[] = [];
  let cursor = 0;
  do {
    const end = Math.min(visible.length, cursor + CoworkRunPolicy.ContentChunkCharacters);
    patches.push({
      sessionId,
      messageId: snapshot.messageId,
      revision,
      baseRevision: 0,
      offset: cursor,
      content: visible.slice(cursor, end),
      totalLength: visible.length,
      complete: end === visible.length,
      truncated: snapshot.truncated,
      ...(end === visible.length ? { metadata } : {}),
    });
    cursor = end;
  } while (cursor < visible.length);
  return patches;
};
