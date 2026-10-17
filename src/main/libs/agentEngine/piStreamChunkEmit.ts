import type { UIMessageChunk } from 'ai';

import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiAssistantTranscript } from './piAssistantTranscript';

const isReasoningChunk = (chunk: UIMessageChunk): boolean => chunk.type.startsWith('reasoning');

/**
 * Resolve which Cowork message a translated UI chunk streams into, or null
 * when the chunk must not reach the renderer at all.
 *
 * Only `text-*` (answer bubble) and `reasoning-*` (thinking bubble) chunks
 * cross to IPC. Everything else — `tool-input-*` / `tool-output-*` streams and
 * envelope start/finish chunks — returns null: the renderer does not consume
 * tool streams on this path (tool state arrives via `toolActivity` events),
 * and resolving them would create empty DB rows and empty placeholder bubbles
 * for turns that answer with a tool call (S2/N3).
 */
export const resolveCoworkStreamMessageId = (
  sessionId: string,
  active: ActivePiSession,
  chunk: UIMessageChunk,
  transcript: PiAssistantTranscript,
): string | null => {
  if (isReasoningChunk(chunk)) {
    return transcript.ensureMessage(sessionId, active, 'thinking', '');
  }
  if (chunk.type.startsWith('text')) {
    return transcript.ensureMessage(sessionId, active, 'answer', '');
  }
  return null;
};
