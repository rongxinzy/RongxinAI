import type { CoworkMessage } from '../../types/cowork';

/**
 * Fold transient direct-chat snapshots into the persisted message list.
 *
 * The renderer may already have applied provider usage metadata to an
 * assistant message when a final snapshot is assembled. Re-appending a
 * transient version with the same ID would overwrite that metadata in SQLite.
 */
export function mergeDirectChatSnapshotMessages(
  messages: CoworkMessage[],
  transientMessages: CoworkMessage[],
): CoworkMessage[] {
  const mergedMessages = messages.map(message => ({
    ...message,
    ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
  }));
  const messageIndexById = new Map(mergedMessages.map((message, index) => [message.id, index]));

  for (const transientMessage of transientMessages) {
    const existingIndex = messageIndexById.get(transientMessage.id);
    if (existingIndex === undefined) {
      messageIndexById.set(transientMessage.id, mergedMessages.length);
      mergedMessages.push(transientMessage);
      continue;
    }

    const existingMessage = mergedMessages[existingIndex];
    mergedMessages[existingIndex] = {
      ...existingMessage,
      ...transientMessage,
      metadata: {
        ...existingMessage.metadata,
        ...transientMessage.metadata,
      },
    };
  }

  return mergedMessages;
}
