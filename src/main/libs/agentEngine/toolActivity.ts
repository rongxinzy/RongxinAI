import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
  type CoworkToolActivityEvent,
  type CoworkToolActivityProgress,
} from '../../../shared/cowork/toolActivity';

const ACTIVITY_INPUT_KEYS = [
  'action',
  'cmd',
  'code',
  'command',
  'commands',
  'description',
  'deliverablePath',
  'file_path',
  'filePath',
  'id',
  'jobId',
  'path',
  'pattern',
  'query',
  'script',
  'session_id',
  'sessionId',
  'target_file',
  'targetFile',
  'task',
  'text',
  'url',
] as const;

const MAX_ACTIVITY_VALUE_LENGTH = 240;
const MAX_ACTIVITY_ARRAY_ITEMS = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const truncateActivityValue = (value: string): string =>
  value.length <= MAX_ACTIVITY_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_ACTIVITY_VALUE_LENGTH - 3)}...`;

const toActivityValue = (value: unknown): unknown => {
  if (typeof value === 'string') return truncateActivityValue(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ACTIVITY_ARRAY_ITEMS)
      .map(toActivityValue)
      .filter(item => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
};

export const toToolActivityInput = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ACTIVITY_INPUT_KEYS) {
    const projected = toActivityValue(value[key]);
    if (projected !== undefined) result[key] = projected;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const parseArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const readString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

export type PreparingToolActivity = {
  toolCallId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  progress?: CoworkToolActivityProgress;
  /** Per-delta argument character count, used when no cumulative snapshot exists. */
  progressDeltaChars?: number;
};

const readPreparingProgress = (
  event: Record<string, unknown>,
  toolCall: Record<string, unknown>,
): Pick<PreparingToolActivity, 'progress' | 'progressDeltaChars'> => {
  const partialJson = toolCall.partialJson;
  if (typeof partialJson === 'string') return { progress: { argsChars: partialJson.length } };
  const delta = event.delta;
  if (typeof delta === 'string' && delta.length > 0) return { progressDeltaChars: delta.length };
  return {};
};

export const getPiPreparingToolActivity = (
  event: unknown,
  fallbackToolCallId: string,
): PreparingToolActivity | null => {
  if (!isRecord(event)) return null;
  const type = typeof event.type === 'string' ? event.type : '';
  if (type !== 'toolcall_start' && type !== 'toolcall_delta' && type !== 'toolcall_end') {
    return null;
  }

  const contentIndex = typeof event.contentIndex === 'number' ? event.contentIndex : -1;
  const partial = isRecord(event.partial) ? event.partial : null;
  const partialContent = partial && Array.isArray(partial.content) ? partial.content : [];
  const partialCall = contentIndex >= 0 ? partialContent[contentIndex] : undefined;
  const completedCall = isRecord(event.toolCall) ? event.toolCall : undefined;
  const toolCall = completedCall ?? (isRecord(partialCall) ? partialCall : undefined);
  if (!toolCall) {
    return { toolCallId: fallbackToolCallId };
  }

  return {
    toolCallId: readString(toolCall, ['id', 'toolCallId', 'tool_call_id']) ?? fallbackToolCallId,
    toolName: readString(toolCall, ['name', 'toolName']),
    toolInput: toToolActivityInput(toolCall.arguments ?? toolCall.args ?? toolCall.input),
    ...readPreparingProgress(event, toolCall),
  };
};

const normalizeBlockType = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]+/g, '') : '';

const isToolCallBlock = (record: Record<string, unknown>): boolean => {
  const type = normalizeBlockType(record.type);
  return type === 'toolcall' || type === 'tooluse' || type === 'functioncall';
};

const getAgentToolActivity = (block: Record<string, unknown>): PreparingToolActivity | null => {
  const functionRecord = isRecord(block.function) ? block.function : undefined;
  const toolCallId = readString(block, ['id', 'toolCallId', 'tool_call_id', 'call_id']);
  if (!toolCallId) return null;
  const rawInput =
    block.arguments ??
    block.args ??
    block.input ??
    functionRecord?.arguments ??
    functionRecord?.args;
  return {
    toolCallId,
    toolName:
      readString(block, ['name', 'toolName']) ??
      (functionRecord ? readString(functionRecord, ['name']) : undefined),
    toolInput: toToolActivityInput(parseArguments(rawInput) ?? rawInput),
  };
};

const AGENT_NESTED_KEYS = ['content', 'data', 'message', 'partial', 'parts', 'response'] as const;

export const extractAgentPreparingToolActivities = (payload: unknown): PreparingToolActivity[] => {
  const activities = new Map<string, PreparingToolActivity>();
  const visited = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || value === null || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (isToolCallBlock(value)) {
      const activity = getAgentToolActivity(value);
      if (activity) activities.set(activity.toolCallId, activity);
    }
    for (const key of AGENT_NESTED_KEYS) {
      if (value[key] !== undefined) visit(value[key], depth + 1);
    }
  };

  visit(payload, 0);
  return [...activities.values()];
};

export const createToolActivityUpsert = (
  activity: PreparingToolActivity,
  phase: CoworkToolActivityPhase = CoworkToolActivityPhase.Preparing,
): CoworkToolActivityEvent => ({
  type: CoworkToolActivityEventType.Upsert,
  activity: {
    toolCallId: activity.toolCallId,
    toolName: activity.toolName,
    toolInput: activity.toolInput,
    progress: activity.progress,
    phase,
    updatedAt: Date.now(),
  },
});

export const createToolActivityRemove = (toolCallId: string): CoworkToolActivityEvent => ({
  type: CoworkToolActivityEventType.Remove,
  toolCallId,
});

export const createToolActivityClear = (): CoworkToolActivityEvent => ({
  type: CoworkToolActivityEventType.Clear,
});

export const TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD = 1024;
export const TOOL_ACTIVITY_PROGRESS_INTERVAL_MS = 250;

type TrackedToolActivity = {
  signature: string;
  argsChars?: number;
  lastEmittedArgsChars?: number;
  lastEmittedAt: number;
};

export class ToolActivityTracker {
  private readonly tracked = new Map<string, TrackedToolActivity>();

  upsert(
    activity: PreparingToolActivity,
    phase: CoworkToolActivityPhase = CoworkToolActivityPhase.Preparing,
  ): CoworkToolActivityEvent | null {
    const now = Date.now();
    const existing = this.tracked.get(activity.toolCallId);
    const signature = JSON.stringify([phase, activity.toolName, activity.toolInput]);

    let argsChars = activity.progress?.argsChars;
    if (argsChars === undefined && activity.progressDeltaChars !== undefined) {
      argsChars = (existing?.argsChars ?? 0) + activity.progressDeltaChars;
    }
    // Carry the last known count forward so later snapshots without a partial
    // payload (e.g. toolcall_end) do not erase the displayed progress.
    if (argsChars === undefined) argsChars = existing?.argsChars;

    const emit = (): CoworkToolActivityEvent => {
      this.tracked.set(activity.toolCallId, {
        signature,
        argsChars,
        lastEmittedArgsChars: argsChars,
        lastEmittedAt: now,
      });
      return createToolActivityUpsert(
        { ...activity, progress: argsChars === undefined ? undefined : { argsChars } },
        phase,
      );
    };

    // Phase, tool name, or projected input changes always emit immediately.
    if (!existing || existing.signature !== signature) return emit();
    if (argsChars === undefined || argsChars === existing.argsChars) return null;

    this.tracked.set(activity.toolCallId, { ...existing, argsChars });
    const charsSinceEmit = argsChars - (existing.lastEmittedArgsChars ?? 0);
    const msSinceEmit = now - existing.lastEmittedAt;
    if (
      charsSinceEmit >= TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD ||
      msSinceEmit >= TOOL_ACTIVITY_PROGRESS_INTERVAL_MS
    ) {
      return emit();
    }
    return null;
  }

  remove(toolCallId: string): CoworkToolActivityEvent | null {
    if (!this.tracked.delete(toolCallId)) return null;
    return createToolActivityRemove(toolCallId);
  }

  clear(): CoworkToolActivityEvent | null {
    if (this.tracked.size === 0) return null;
    this.tracked.clear();
    return createToolActivityClear();
  }
}
