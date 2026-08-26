import {
  classifyCoworkError,
  type CoworkError,
  CoworkErrorKind,
  ENGINE_NOT_READY_CODE,
} from '../../common/coworkError';
import type { CoworkMessage, CoworkSession } from '../types/cowork';

type CoworkMessageSession = Pick<CoworkSession, 'id' | 'messages'>;

export const isCoworkTerminalErrorMessage = (message: CoworkMessage): boolean =>
  message.type === 'system' && typeof message.metadata?.error === 'string';

export const resolveCoworkTerminalError = (message: string, code?: string): CoworkError =>
  code === ENGINE_NOT_READY_CODE
    ? {
        kind: CoworkErrorKind.EngineNotReady,
        message,
        raw: message,
      }
    : classifyCoworkError(message);

export const createCoworkTerminalErrorMessage = (
  error: CoworkError,
  timestamp = Date.now(),
): CoworkMessage => ({
  id: `error-${timestamp}`,
  type: 'system',
  content: '',
  timestamp,
  metadata: {
    error: error.message,
    errorKind: error.kind,
  },
});

export const hasMatchingLatestTerminalError = (
  sessions: Array<CoworkMessageSession | null | undefined>,
  sessionId: string,
  error: CoworkError,
): boolean =>
  sessions.some(session => {
    if (session?.id !== sessionId) return false;
    const latestMessage = session.messages[session.messages.length - 1];
    return (
      Boolean(latestMessage) &&
      isCoworkTerminalErrorMessage(latestMessage) &&
      latestMessage.metadata?.error === error.message &&
      latestMessage.metadata?.errorKind === error.kind
    );
  });
