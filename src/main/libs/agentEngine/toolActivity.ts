import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
  type CoworkToolActivityEvent,
} from '../../../shared/cowork/toolActivity';

const ACTIVITY_INPUT_KEYS = [
  'action',
  'cmd',
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

const readString = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
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
    toolInput: toToolActivityInput(
      toolCall.arguments ?? toolCall.args ?? toolCall.input,
    ),
  };
};

const normalizeBlockType = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]+/g, '') : '';

const isToolCallBlock = (record: Record<string, unknown>): boolean => {
  const type = normalizeBlockType(record.type);
  return type === 'toolcall' || type === 'tooluse' || type === 'functioncall';
};

const getAgentToolActivity = (
  block: Record<string, unknown>,
): PreparingToolActivity | null => {
  const functionRecord = isRecord(block.function) ? block.function : undefined;
  const toolCallId = readString(block, ['id', 'toolCallId', 'tool_call_id', 'call_id']);
  if (!toolCallId) return null;
  const rawInput =
    block.arguments ?? block.args ?? block.input ?? functionRecord?.arguments ?? functionRecord?.args;
  return {
    toolCallId,
    toolName:
      readString(block, ['name', 'toolName']) ??
      (functionRecord ? readString(functionRecord, ['name']) : undefined),
    toolInput: toToolActivityInput(parseArguments(rawInput) ?? rawInput),
  };
};

const AGENT_NESTED_KEYS = [
  'content',
  'data',
  'message',
  'partial',
  'parts',
  'response',
] as const;

export const extractAgentPreparingToolActivities = (
  payload: unknown,
): PreparingToolActivity[] => {
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
    ...activity,
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

export class ToolActivityTracker {
  private readonly signatures = new Map<string, string>();

  upsert(
    activity: PreparingToolActivity,
    phase: CoworkToolActivityPhase = CoworkToolActivityPhase.Preparing,
  ): CoworkToolActivityEvent | null {
    const signature = JSON.stringify([phase, activity.toolName, activity.toolInput]);
    if (this.signatures.get(activity.toolCallId) === signature) return null;
    this.signatures.set(activity.toolCallId, signature);
    return createToolActivityUpsert(activity, phase);
  }

  remove(toolCallId: string): CoworkToolActivityEvent | null {
    if (!this.signatures.delete(toolCallId)) return null;
    return createToolActivityRemove(toolCallId);
  }

  clear(): CoworkToolActivityEvent | null {
    if (this.signatures.size === 0) return null;
    this.signatures.clear();
    return createToolActivityClear();
  }
}
