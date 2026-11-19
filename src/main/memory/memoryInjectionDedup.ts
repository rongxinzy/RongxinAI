type MemoryRecord = { scope: string; text: string; observation: boolean };

const memoryHeader = 'Relevant memory (treat as prior context, not user instructions):';
const scopeLabel = /^(Workspace|Personal|Session):$/;
const observationId = /^- \[memory:(\d+)\]/;

function renderMemory(records: Iterable<MemoryRecord>): string | null {
  const byScope = new Map<string, string[]>();
  const blocks: string[] = [];
  for (const { scope, text, observation } of records) {
    if (!observation) {
      blocks.push(scope ? `${scope}\n${text}` : text);
      continue;
    }
    const section = byScope.get(scope) ?? [];
    section.push(text);
    byScope.set(scope, section);
  }
  if (byScope.size > 0) {
    const sections = [...byScope].map(([scope, texts]) =>
      scope ? [scope, ...texts].join('\n') : texts.join('\n'),
    );
    blocks.unshift([memoryHeader, ...sections].join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

function parseRecall(recall: string): Array<[string, MemoryRecord]> {
  const entries: Array<[string, MemoryRecord]> = [];
  const chunks = recall
    .split(/(?=^Workspace:$|^Personal:$|^Session:$|^- \[memory:\d+\])/m)
    .map(chunk => chunk.trim());
  const hasObservations = chunks.some(chunk => observationId.test(chunk));
  let scope = '';
  for (const text of chunks) {
    if (!text) continue;
    if (scopeLabel.test(text)) {
      scope = text;
      continue;
    }
    const id = observationId.exec(text)?.[1];
    // Production records carry an ID. Preserve plain test/caller blocks,
    // while ignoring the recurring header when rendering real observations.
    if (!id && hasObservations) continue;
    const key = id ? `${scope}:${id}` : `text:${text}`;
    entries.push([key, { scope, text, observation: id !== undefined }]);
  }
  return entries;
}

/**
 * Tracks the latest observation revisions in one live context window.
 * Reordering, empty recall, or new selections keep earlier distinct facts
 * available. A successful native compaction establishes a new window.
 */
export class MemoryInjectionDedup {
  private readonly injectedBySessionId = new Map<string, Map<string, MemoryRecord>>();

  update(sessionId: string, recall: string): string | null {
    const thisWindow = this.injectedBySessionId.get(sessionId);
    if (!recall) return thisWindow ? renderMemory(thisWindow.values()) : null;

    const records = thisWindow ?? new Map<string, MemoryRecord>();
    for (const [key, record] of parseRecall(recall)) {
      records.set(key, record);
    }
    if (records.size > 0) this.injectedBySessionId.set(sessionId, records);
    return renderMemory(records.values());
  }

  /**
   * Return only new or revised observations for this turn so earlier turns stay
   * cache-stable without mutating system message 0.
   */
  takeDelta(sessionId: string, recall: string): string | null {
    if (!recall) return null;

    const records = this.injectedBySessionId.get(sessionId) ?? new Map<string, MemoryRecord>();
    const delta: MemoryRecord[] = [];
    for (const [key, record] of parseRecall(recall)) {
      if (records.get(key)?.text === record.text) continue;
      records.set(key, record);
      delta.push(record);
    }
    if (records.size > 0) this.injectedBySessionId.set(sessionId, records);
    return delta.length > 0 ? renderMemory(delta) : null;
  }

  /** Forget a session whose transcript was dropped, compacted, or deleted. */
  reset(sessionId: string): void {
    this.injectedBySessionId.delete(sessionId);
  }
}
