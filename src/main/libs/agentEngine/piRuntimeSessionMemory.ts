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
import { getPiModules, type ActivePiSession, type PiModelRuntime } from './piRuntimeSessionState';
import type {
  SessionMemoryCompletion,
  SessionMemoryCompletionMessage,
} from '../../memory/sessionMemoryExtractor';

export interface PiSessionMemoryHost {}

export class PiRuntimeSessionMemory {
  private readonly pendingMemoryCompletions = new Map<string, Promise<string>>();

  constructor(private readonly host: PiSessionMemoryHost) {}

  createCompletion(active: ActivePiSession): SessionMemoryCompletion {
    const sessionId = active.sessionId;
    const model = active.model;
    const modelRuntime = active.modelRuntime;
    const modelRequestOptions = active.modelRequestOptions;
    return messages => {
      const previous = this.pendingMemoryCompletions.get(sessionId) ?? Promise.resolve('');
      const current = previous
        .catch(() => '')
        .then(() => this.completeSessionMemory(model, modelRuntime, modelRequestOptions, messages))
        .finally(() => {
          if (this.pendingMemoryCompletions.get(sessionId) === current) {
            this.pendingMemoryCompletions.delete(sessionId);
          }
        });
      this.pendingMemoryCompletions.set(sessionId, current);
      return current;
    };
  }

  private async completeSessionMemory(
    model: Record<string, unknown>,
    modelRuntime: PiModelRuntime | null,
    modelRequestOptions: { apiKey?: string } | undefined,
    messages: readonly SessionMemoryCompletionMessage[],
  ): Promise<string> {
    const pi = await getPiModules();
    const context = buildPiBackgroundCompletionContext(messages);
    const result = modelRuntime?.completeSimple
      ? await modelRuntime.completeSimple(model, context)
      : await pi.completeSimple(model, context, modelRequestOptions);
    return extractPiBackgroundCompletionText(result);
  }
}
