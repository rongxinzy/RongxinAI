import {
  classifyCoworkError,
  type CoworkError,
  CoworkErrorKind,
  ENGINE_NOT_READY_CODE,
} from '../../common/coworkError';
import type { CoworkMessage, CoworkSession } from '../types/cowork';

type CoworkMessageSession = Pick<CoworkSession, 'id' | 'messages'>;

/** 2026/09/15 lixiang  Prefer extracting error.message from JSON when present **/
const tryExtractMessageFromJson = (value: string): string | null => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const errorObj = parsed.error;
    if (errorObj && typeof errorObj === 'object' && !Array.isArray(errorObj)) {
      const message = (errorObj as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // Not JSON.
  }
  return null;
};

/**
 * 2026/09/15 lixiang  User-facing error text:
 * use error.message directly when present; do not wrap with a request-failed prefix
 */
export const extractUserFacingErrorMessage = (raw: string): string => {
  const value = raw.trim();
  if (!value) return raw;

  const fromJson = tryExtractMessageFromJson(value);
  if (fromJson) return fromJson;

  // 2026/09/15 lixiang  Support JSON embedded after a prefix, e.g. "xxx: {...}"
  const jsonMatch = value.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const fromEmbedded = tryExtractMessageFromJson(jsonMatch[0]);
    if (fromEmbedded) return fromEmbedded;
  }

  return value;
};

export const isCoworkTerminalErrorMessage = (message: CoworkMessage): boolean => {
  if (message.type !== 'system') return false;
  if (typeof message.metadata?.error === 'string') return true;
  if (typeof message.content !== 'string' || !message.content.trim()) return false;
  // 2026/09/15 lixiang  Legacy sessions store error JSON in content; treat as terminal so it is not folded under "Working"
  return extractUserFacingErrorMessage(message.content) !== message.content.trim();
};

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

/** 2026/09/15 lixiang  Persist Direct Chat failures as canonical terminal errors for TurnBlock **/
export const createDirectChatTerminalErrorMessage = (
  error: unknown,
  timestamp = Date.now(),
): CoworkMessage => {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const message = extractUserFacingErrorMessage(raw);
  return createCoworkTerminalErrorMessage(resolveCoworkTerminalError(message), timestamp);
};

/** 2026/09/15 lixiang  Terminal error bubble text; prefer metadata.error and unwrap JSON payloads **/
export const getTerminalErrorDisplayText = (message: CoworkMessage): string => {
  if (typeof message.metadata?.error === 'string' && message.metadata.error.trim()) {
    return extractUserFacingErrorMessage(message.metadata.error);
  }
  if (typeof message.content === 'string' && message.content.trim()) {
    return extractUserFacingErrorMessage(message.content);
  }
  return '';
};

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
