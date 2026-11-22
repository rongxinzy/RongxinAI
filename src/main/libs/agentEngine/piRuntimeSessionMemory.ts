/**
 * Session memory completion for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: serializes per-session memory extraction
 * completions (each request chains onto the previous one). Session checkpoints
 * themselves are agent-authored via the session_summary tool, not rolled up
 * from the transcript here.
 */

import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
} from './piBackgroundCompletion';
import type { ActivePiSession } from './piRuntimeSessionState';
import type { SessionMemoryCompletion } from '../../memory/sessionMemoryExtractor';

export class PiRuntimeSessionMemory {
  private readonly pendingMemoryCompletions = new Map<string, Promise<string>>();

  createCompletion(active: ActivePiSession): SessionMemoryCompletion {
    const { sessionId, model, modelRuntime } = active;
    return messages => {
      const previous = this.pendingMemoryCompletions.get(sessionId) ?? Promise.resolve('');
      const current = previous
        .catch(() => '')
        .then(async () => {
          const context = buildPiBackgroundCompletionContext(messages);
          return extractPiBackgroundCompletionText(
            await modelRuntime.completeSimple(model, context),
          );
        })
        .finally(() => {
          if (this.pendingMemoryCompletions.get(sessionId) === current) {
            this.pendingMemoryCompletions.delete(sessionId);
          }
        });
      this.pendingMemoryCompletions.set(sessionId, current);
      return current;
    };
  }
}
