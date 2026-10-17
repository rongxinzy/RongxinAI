import type { UIMessageChunk } from 'ai';

import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiAssistantTranscript } from './piAssistantTranscript';

const isReasoningChunk = (chunk: UIMessageChunk): boolean => chunk.type.startsWith('reasoning');

export const resolveCoworkStreamMessageId = (
  sessionId: string,
  active: ActivePiSession,
  chunk: UIMessageChunk,
  transcript: PiAssistantTranscript,
): string | null => {
  if (isReasoningChunk(chunk)) {
    return transcript.ensureMessage(sessionId, active, 'thinking', '');
  }
  if (chunk.type.startsWith('text') || chunk.type.startsWith('tool-')) {
    return transcript.ensureMessage(sessionId, active, 'answer', '');
  }
  return active.assistantMessageId;
};
