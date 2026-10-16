/**
 * Size-bounded sanitizers applied before forwarding Cowork payloads across the
 * main -> renderer IPC boundary. Pure functions; safe to unit test.
 */
import type { CoworkMessageMetadata } from '../coworkStore';
import { slimImageAttachmentsForIpc, slimQueuedMessagesForIpc } from '../coworkImageAttachments';

const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;

export const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated in main IPC forwarding]`;
};

export const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, IPC_MAX_ITEMS)
      .map(entry => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[truncated-items:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[circular]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

export const sanitizeCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as { metadata?: unknown; content?: unknown };

  // Stream forwarding: truncate large payloads so a single frame cannot stall IPC.
  let sanitizedMetadata: unknown;
  if (messageRecord.metadata && typeof messageRecord.metadata === 'object') {
    const { imageAttachments, fileAttachments, ...rest } = messageRecord.metadata as Record<
      string,
      unknown
    >;
    const sanitizedRest = sanitizeIpcPayload(rest) as Record<string, unknown> | undefined;
    const slimImages = slimImageAttachmentsForIpc(imageAttachments);
    sanitizedMetadata = {
      ...(sanitizedRest && typeof sanitizedRest === 'object' ? sanitizedRest : {}),
      ...(slimImages ? { imageAttachments: slimImages } : {}),
      ...(Array.isArray(fileAttachments) && fileAttachments.length > 0
        ? {
            fileAttachments: fileAttachments
              .filter(
                (attachment): attachment is Record<string, unknown> =>
                  Boolean(attachment) && typeof attachment === 'object',
              )
              .slice(0, IPC_MAX_ITEMS)
              .map(attachment => ({
                name: typeof attachment.name === 'string' ? attachment.name : '',
                path: typeof attachment.path === 'string' ? attachment.path : '',
                extension: typeof attachment.extension === 'string' ? attachment.extension : '',
                ...(typeof attachment.isImage === 'boolean' ? { isImage: attachment.isImage } : {}),
              })),
          }
        : {}),
    };
  } else {
    sanitizedMetadata = undefined;
  }

  return {
    ...message,
    content:
      typeof messageRecord.content === 'string'
        ? truncateIpcString(messageRecord.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
        : '',
    metadata: sanitizedMetadata,
  };
};

/** Session load/save: drop image bytes + redundant toolResult copies. */
export const slimCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as {
    type?: unknown;
    content?: unknown;
    metadata?: unknown;
  };
  const content = typeof messageRecord.content === 'string' ? messageRecord.content : undefined;
  const shouldTruncateToolResult =
    messageRecord.type === 'tool_result' &&
    typeof content === 'string' &&
    content.length > IPC_MESSAGE_CONTENT_MAX_CHARS;

  if (!messageRecord.metadata || typeof messageRecord.metadata !== 'object') {
    if (!shouldTruncateToolResult) return message;
    return {
      ...message,
      content: truncateIpcString(content!, IPC_MESSAGE_CONTENT_MAX_CHARS),
    };
  }

  const { imageAttachments, toolResult, ...rest } = messageRecord.metadata as Record<
    string,
    unknown
  >;
  const slimImages = slimImageAttachmentsForIpc(imageAttachments);
  // Prefer content; only keep metadata.toolResult when content is empty (legacy rows).
  const keepToolResult =
    typeof toolResult === 'string' &&
    toolResult.length > 0 &&
    !(typeof content === 'string' && content.length > 0);

  return {
    ...message,
    ...(shouldTruncateToolResult
      ? { content: truncateIpcString(content!, IPC_MESSAGE_CONTENT_MAX_CHARS) }
      : {}),
    metadata: {
      ...rest,
      ...(slimImages ? { imageAttachments: slimImages } : {}),
      ...(keepToolResult ? { toolResult } : {}),
    },
  };
};

export const sanitizeCoworkSessionForIpc = <T extends { messages?: unknown[] }>(session: T): T => {
  if (!session?.messages?.length) return session;
  return {
    ...session,
    messages: session.messages.map(message => slimCoworkMessageForIpc(message)),
  };
};

export const sanitizePermissionRequestForIpc = (request: unknown): unknown => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  const requestRecord = request as { toolInput?: unknown };
  return {
    ...request,
    toolInput: sanitizeIpcPayload(requestRecord.toolInput ?? {}),
  };
};
