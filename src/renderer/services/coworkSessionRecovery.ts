import type { CoworkSession } from '../types/cowork';

/** Keep loaded history and newer live messages while filling messages missed during disconnection. */
export function mergeRecoveredSession(
  existing: CoworkSession,
  recovered: CoworkSession,
): CoworkSession {
  const messages = new Map(existing.messages.map(message => [message.id, message]));
  for (const message of recovered.messages) {
    const live = messages.get(message.id);
    // Live updates can have arrived after the snapshot request was sent.
    if (!live || (message.content.length >= live.content.length && !live.metadata?.isStreaming)) {
      messages.set(message.id, message);
    }
  }
  return {
    ...recovered,
    messages: [...messages.values()].sort((a, b) => a.timestamp - b.timestamp),
    messagesOffset: Math.min(existing.messagesOffset, recovered.messagesOffset),
    totalMessages: Math.max(existing.totalMessages, recovered.totalMessages, messages.size),
  };
}
