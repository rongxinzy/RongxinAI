import {
  parseScheduledReminderPrompt,
  parseSimpleScheduledReminderText,
} from '../../scheduledTask/reminderText';

type GatewayHistoryRole = 'user' | 'assistant' | 'system';

export interface GatewayHistoryEntry {
  role: GatewayHistoryRole;
  text: string;
  timestamp?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; totalTokens?: number };
  model?: string;
}

const HEARTBEAT_ACK_RE =
  /^[`*_~"'“”‘’()[\]{}<>.,!?;:，。！？；：\s-]{0,8}HEARTBEAT_OK[`*_~"'“”‘’()[\]{}<>.,!?;:，。！？；：\s-]{0,8}$/i;
const SILENT_REPLY_RE = /^\s*NO_REPLY\s*$/i;
const SILENT_REPLY_TOKEN = 'NO_REPLY';
const HEARTBEAT_PROMPT_MARKERS = [
  'read heartbeat.md if it exists',
  'when reading heartbeat.md',
  'reply heartbeat_ok',
  'do not infer or repeat old tasks from prior chats',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const collectTextChunks = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectTextChunks(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const chunks: string[] = [];
  if (typeof value.text === 'string') {
    const text = value.text.trim();
    if (text) {
      chunks.push(text);
    }
  }

  if (value.content !== undefined) {
    chunks.push(...collectTextChunks(value.content));
  }
  if (value.parts !== undefined) {
    chunks.push(...collectTextChunks(value.parts));
  }

  return chunks;
};

const parseGatewayTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const extractGatewayTimestamp = (message: Record<string, unknown>): number | undefined => {
  return (
    parseGatewayTimestamp(message.timestamp) ??
    parseGatewayTimestamp(message.createdAt) ??
    parseGatewayTimestamp(message.created_at) ??
    parseGatewayTimestamp(message.time)
  );
};

export const extractGatewayMessageText = (message: unknown): string => {
  if (typeof message === 'string') {
    return message;
  }
  if (!isRecord(message)) {
    return '';
  }

  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const chunks = collectTextChunks(content);
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }
  if (isRecord(content)) {
    const chunks = collectTextChunks(content);
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }
  if (typeof message.text === 'string') {
    return message.text;
  }
  return '';
};

export const buildScheduledReminderSystemMessage = (text: string): string | null => {
  const parsed = parseScheduledReminderPrompt(text);
  if (!parsed) {
    return parseSimpleScheduledReminderText(text)?.reminderText ?? null;
  }

  return parsed.reminderText;
};

export const isHeartbeatAckText = (text: string): boolean => HEARTBEAT_ACK_RE.test(text.trim());

export const isSilentReplyText = (text: string): boolean => SILENT_REPLY_RE.test(text.trim());

export const isSilentReplyPrefixText = (text: string): boolean => {
  const trimmed = text.trimStart();
  if (!trimmed || trimmed.length < 2) return false;
  if (trimmed !== trimmed.toUpperCase()) return false;
  if (/[^A-Z_]/.test(trimmed)) return false;
  const tokenUpper = SILENT_REPLY_TOKEN.toUpperCase();
  if (!tokenUpper.startsWith(trimmed)) return false;
  if (trimmed.includes('_')) return true;
  return trimmed === 'NO';
};

export const isHeartbeatPromptText = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return HEARTBEAT_PROMPT_MARKERS.every(marker => normalized.includes(marker));
};

export const shouldSuppressHeartbeatText = (role: GatewayHistoryRole, text: string): boolean => {
  if (
    (role === 'assistant' || role === 'system') &&
    (isHeartbeatAckText(text) || isSilentReplyText(text))
  ) {
    return true;
  }
  if (role === 'user' && isHeartbeatPromptText(text)) {
    return true;
  }
  return false;
};

export const extractGatewayHistoryEntry = (message: unknown): GatewayHistoryEntry | null => {
  if (!isRecord(message)) {
    return null;
  }

  const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null;
  }

  const text = extractGatewayMessageText(message).trim();
  if (!text) {
    return null;
  }
  if (shouldSuppressHeartbeatText(role, text)) {
    return null;
  }

  const reminderSystemMessage = role === 'user' ? buildScheduledReminderSystemMessage(text) : null;
  const timestamp = extractGatewayTimestamp(message);
  if (reminderSystemMessage) {
    return {
      role: 'system',
      text: reminderSystemMessage,
      ...(timestamp != null && { timestamp }),
    };
  }

  // Extract usage and model for assistant messages
  let usage:
    | { input?: number; output?: number; cacheRead?: number; totalTokens?: number }
    | undefined;
  let model: string | undefined;
  if (role === 'assistant') {
    if (isRecord(message.usage)) {
      const u = message.usage as Record<string, unknown>;
      const input =
        typeof u.input === 'number'
          ? u.input
          : typeof u.inputTokens === 'number'
            ? u.inputTokens
            : undefined;
      const output =
        typeof u.output === 'number'
          ? u.output
          : typeof u.outputTokens === 'number'
            ? u.outputTokens
            : undefined;
      const cacheRead =
        typeof u.cacheRead === 'number'
          ? u.cacheRead
          : typeof u.cacheReadTokens === 'number'
            ? u.cacheReadTokens
            : undefined;
      const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : undefined;
      if (input != null || output != null || cacheRead != null || totalTokens != null) {
        usage = {
          ...(input != null && { input }),
          ...(output != null && { output }),
          ...(cacheRead != null && { cacheRead }),
          ...(totalTokens != null && { totalTokens }),
        };
      }
    }
    if (typeof message.model === 'string') {
      model = message.model;
    }
  }

  return {
    role,
    text,
    ...(timestamp != null && { timestamp }),
    ...(usage && { usage }),
    ...(model && { model }),
  };
};

export const extractGatewayHistoryEntries = (messages: unknown[]): GatewayHistoryEntry[] => {
  return messages
    .map(message => extractGatewayHistoryEntry(message))
    .filter((entry): entry is GatewayHistoryEntry => entry !== null);
};
