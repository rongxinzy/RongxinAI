import type { CoworkMessage } from '../../types/cowork';
import type { CodingConversationTurn } from './codingEventProjection';

/** Converts completed coding answers into the existing artifact parser input. */
export const toDetectableCodingMessages = (turns: CodingConversationTurn[]): CoworkMessage[] =>
  turns.flatMap(turn =>
    turn.assistantMessages
      .filter(message => message.content.trim())
      .map(message => ({
        id: message.id,
        type: 'assistant' as const,
        content: message.content,
        timestamp: message.createdAt,
        metadata: message.isFinalAnswer ? { isFinalAnswer: true } : undefined,
      })),
  );
