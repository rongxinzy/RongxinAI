import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';

export interface CodingToolCallLocation {
  path: string;
  line: number | null;
}

export interface CodingToolCallDiff {
  path: string;
  oldText: string;
  newText: string;
}

export interface CodingToolCallView {
  title: string | null;
  /** ACP tool kind: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. */
  kind: string | null;
  status: string | null;
  locations: CodingToolCallLocation[];
  diffs: CodingToolCallDiff[];
  /** Text produced by the tool call itself (content blocks of type text). */
  output: string | null;
  rawInput: string | null;
  rawOutput: string | null;
}

export interface CodingPlanEntry {
  content: string;
  status: string;
  priority: string | null;
}

const MAX_RAW_FIELD_LENGTH = 20_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const truncate = (value: string): string =>
  value.length > MAX_RAW_FIELD_LENGTH ? `${value.slice(0, MAX_RAW_FIELD_LENGTH)}\n…` : value;

const formatRawValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value ? truncate(value) : null;
  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return null;
  }
};

const parseLocations = (value: unknown): CodingToolCallLocation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    const path = readString(record?.path);
    if (!path) return [];
    const line =
      typeof record?.line === 'number' && Number.isInteger(record.line) && record.line > 0
        ? record.line
        : null;
    return [{ path, line }];
  });
};

const parseDiffs = (value: unknown): CodingToolCallDiff[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const record = asRecord(item);
    if (record?.type !== 'diff') return [];
    const path = readString(record.path);
    if (!path) return [];
    return [
      {
        path,
        oldText: typeof record.oldText === 'string' ? record.oldText : '',
        newText: typeof record.newText === 'string' ? record.newText : '',
      },
    ];
  });
};

const parseContentText = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record?.type !== 'content') continue;
    const content = asRecord(record.content);
    if (content?.type === 'text' && typeof content.text === 'string' && content.text) {
      parts.push(content.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
};

/**
 * Normalizes an ACP tool_call / tool_call_update payload (or the equivalent
 * built-in agent activity payload) into a render-ready view model.
 */
export const parseToolCallView = (payload: Record<string, unknown>): CodingToolCallView => ({
  title: readString(payload.title) ?? readString(payload.name) ?? readString(payload.toolName),
  kind: readString(payload.kind),
  status: readString(payload.status),
  locations: parseLocations(payload.locations),
  diffs: parseDiffs(payload.content),
  output: parseContentText(payload.content),
  rawInput: formatRawValue(payload.rawInput),
  rawOutput: formatRawValue(payload.rawOutput),
});

export const hasToolCallDetails = (view: CodingToolCallView): boolean =>
  view.locations.length > 0 ||
  view.diffs.length > 0 ||
  view.output !== null ||
  view.rawInput !== null ||
  view.rawOutput !== null;

/**
 * Extracts structured plan entries from an ACP plan payload. Returns null when
 * the payload does not carry a usable entries list, so callers can fall back
 * to a raw rendering.
 */
export const parsePlanEntries = (payload: Record<string, unknown>): CodingPlanEntry[] | null => {
  if (!Array.isArray(payload.entries)) return null;
  const entries = payload.entries.flatMap(item => {
    const record = asRecord(item);
    const content = readString(record?.content);
    if (!content) return [];
    const status = readString(record?.status) ?? 'pending';
    return [{ content, status, priority: readString(record?.priority) }];
  });
  return entries;
};

export const isToolCallEvent = (event: CodingEvent): boolean =>
  event.kind === CodingEventKind.ToolCall;
