import { randomUUID } from 'crypto';

import { CodingEventKind, CodingStreamUpdateMode } from '../../../shared/codingAgent';
import { AcpSessionUpdateKind } from '../acp/protocol';
import { MAX_INLINE_DATA_LENGTH, asRecord, type DriverEvent } from './acpDriverSupport';

const contentBlockToMarkdown = (block: Record<string, unknown>): string | null => {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : null;
    case 'image': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      if (uri) return `![${uri}](${uri})`;
      if (typeof block.data === 'string' && typeof block.mimeType === 'string') {
        return block.data.length <= MAX_INLINE_DATA_LENGTH
          ? `![image](data:${block.mimeType};base64,${block.data})`
          : `[image: ${block.mimeType}]`;
      }
      return null;
    }
    case 'audio': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'audio';
      return uri ? `[audio (${mimeType})](${uri})` : `[audio: ${mimeType}]`;
    }
    case 'resource_link': {
      const uri = typeof block.uri === 'string' && block.uri ? block.uri : null;
      const label =
        (typeof block.title === 'string' && block.title.trim()) ||
        (typeof block.name === 'string' && block.name.trim()) ||
        uri;
      if (!label) return null;
      return uri ? `[${label}](${uri})` : label;
    }
    case 'resource': {
      const resource = asRecord(block.resource);
      if (typeof resource.text === 'string') return resource.text;
      const uri = typeof resource.uri === 'string' && resource.uri ? resource.uri : null;
      return uri ? `[${uri}](${uri})` : null;
    }
    default:
      return null;
  }
};

/**
 * Flattens ACP content blocks (text, image, audio, resource_link, resource)
 * into markdown so no block type is silently dropped from the transcript.
 * Adjacent text blocks join directly; non-text blocks are separated by a
 * blank line so they render as distinct markdown elements.
 */
const readContentText = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return contentBlockToMarkdown(asRecord(value));
  let text = '';
  let previousWasText = true;
  for (const item of value) {
    const block = asRecord(item);
    const markdown = contentBlockToMarkdown(block);
    if (markdown === null) continue;
    const isTextBlock = block.type === 'text';
    if (text && (!isTextBlock || !previousWasText)) text += '\n\n';
    text += markdown;
    previousWasText = isTextBlock;
  }
  return text || null;
};

/**
 * Normalizes ACP session updates into driver events, supplying stable fallback
 * message ids for agents that stream message chunks without a messageId.
 */
export class AcpSessionUpdateNormalizer {
  private readonly fallbackMessageIds = new Map<string, string>();

  /** Drops cached fallback message ids so a new turn starts a fresh message. */
  forgetMessageFallbacks(sessionId: string): void {
    this.fallbackMessageIds.delete(this.messageFallbackKey(sessionId, 'assistant'));
    this.fallbackMessageIds.delete(this.messageFallbackKey(sessionId, 'user'));
  }

  normalizeUpdate(sessionId: string, update: Record<string, unknown>): DriverEvent[] {
    const kind = update.sessionUpdate ?? update.kind;
    if (
      kind === AcpSessionUpdateKind.AgentMessageChunk ||
      kind === AcpSessionUpdateKind.UserMessageChunk
    ) {
      const text = readContentText(update.content);
      return text === null
        ? []
        : [
            {
              kind: CodingEventKind.MessageDelta,
              payload: {
                content: text,
                messageId:
                  typeof update.messageId === 'string'
                    ? update.messageId
                    : this.fallbackMessageId(
                        sessionId,
                        kind === AcpSessionUpdateKind.UserMessageChunk ? 'user' : 'assistant',
                      ),
                role: kind === AcpSessionUpdateKind.UserMessageChunk ? 'user' : 'assistant',
                streamUpdateMode: CodingStreamUpdateMode.Append,
              },
            },
          ];
    }
    if (kind === AcpSessionUpdateKind.AgentThoughtChunk) {
      const text = readContentText(update.content);
      return text === null ? [] : [{ kind: CodingEventKind.Reasoning, payload: { content: text } }];
    }
    if (
      kind === AcpSessionUpdateKind.Plan ||
      kind === AcpSessionUpdateKind.PlanUpdate ||
      kind === AcpSessionUpdateKind.PlanRemoved
    ) {
      return [{ kind: CodingEventKind.Plan, payload: update }];
    }
    if (kind === AcpSessionUpdateKind.ToolCall || kind === AcpSessionUpdateKind.ToolCallUpdate) {
      const events: DriverEvent[] = [{ kind: CodingEventKind.ToolCall, payload: update }];
      for (const item of Array.isArray(update.content) ? update.content : []) {
        const content = asRecord(item);
        if (content.type === 'diff') {
          events.push({ kind: CodingEventKind.FileChange, payload: content });
        }
        if (content.type === 'terminal') {
          events.push({ kind: CodingEventKind.Terminal, payload: content });
        }
      }
      return events;
    }
    if (kind === AcpSessionUpdateKind.UsageUpdate) {
      return [{ kind: CodingEventKind.Usage, payload: update }];
    }
    if (typeof update.content === 'string') {
      return [{ kind: CodingEventKind.Message, payload: { content: update.content } }];
    }
    return [];
  }

  private messageFallbackKey(sessionId: string, role: 'assistant' | 'user'): string {
    return `${sessionId}:${role}`;
  }

  private fallbackMessageId(sessionId: string, role: 'assistant' | 'user'): string {
    const key = this.messageFallbackKey(sessionId, role);
    const existing = this.fallbackMessageIds.get(key);
    if (existing) return existing;
    const messageId = randomUUID();
    this.fallbackMessageIds.set(key, messageId);
    return messageId;
  }
}
