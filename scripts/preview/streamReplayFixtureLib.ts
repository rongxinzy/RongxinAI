import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RecordedStreamReplayTrace } from '../../tests/helpers/recordGlmStreamIpcTrace';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{8,32}$/i;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizeStreamReplayTrace(slug: string, trace: RecordedStreamReplayTrace): JsonValue {
  const uuidMap = new Map<string, string>();
  let uuidCounter = 0;
  let timeCounter = 0;
  const mapId = (value: string): string => {
    if (!UUID_PATTERN.test(value) && !HEX_ID_PATTERN.test(value)) return value;
    const existing = uuidMap.get(value);
    if (existing) return existing;
    uuidCounter += 1;
    const next = `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    uuidMap.set(value, next);
    return next;
  };

  const walk = (value: unknown, key?: string): JsonValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (key === 'timestamp' || key === 'emittedAt') {
        timeCounter += 1;
        return 1_700_000_000_000 + timeCounter;
      }
      return value;
    }
    if (typeof value === 'string') return mapId(value);
    if (Array.isArray(value)) return value.map(entry => walk(entry));
    const record = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      out[childKey] = walk(childValue, childKey);
    }
    return out;
  };

  return {
    sessionId: trace.sessionId,
    fixture: slug,
    expectedFinalText: trace.expectedFinalText,
    markers: walk(trace.markers) as JsonValue,
    events: trace.events.map(entry => ({
      delayMs: entry.delayMs,
      event: walk(entry.event),
    })),
  };
}

export function writeStreamReplayFixture(
  outDir: string,
  name: string,
  trace: RecordedStreamReplayTrace,
): void {
  const normalized = normalizeStreamReplayTrace(name, trace);
  const json = `${JSON.stringify(normalized)}\n`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${name}.json`), json, 'utf8');
}
