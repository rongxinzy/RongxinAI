import type { CoworkMessage } from '../../types/cowork';

/** Merge ordered history windows using shared IDs as anchors, preserving live content. */
export function mergeMessageHistory(
  persisted: CoworkMessage[],
  live: CoworkMessage[],
): CoworkMessage[] {
  const liveIndexes = new Map(live.map((message, index) => [message.id, index]));
  const persistedIds = new Set(persisted.map(message => message.id));
  const merged: CoworkMessage[] = [];
  let liveCursor = 0;

  for (const message of persisted) {
    const anchor = liveIndexes.get(message.id);
    if (anchor === undefined) {
      merged.push(message);
      continue;
    }
    // A recent history page may omit the user prompt and earlier tool events.
    // Insert those BEFORE their next shared message, rather than at the end.
    while (liveCursor < anchor) {
      const earlier = live[liveCursor++];
      if (!persistedIds.has(earlier.id)) merged.push(earlier);
    }
    merged.push(live[anchor]);
    liveCursor = Math.max(liveCursor, anchor + 1);
  }
  for (; liveCursor < live.length; liveCursor += 1) {
    if (!persistedIds.has(live[liveCursor].id)) merged.push(live[liveCursor]);
  }
  return merged;
}
