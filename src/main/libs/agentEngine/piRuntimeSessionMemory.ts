/**
 * Session memory completion for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: serializes per-session memory extraction
 * completions (each request chains onto the previous one) and runs the
 * post-turn summary maintenance (rollup + semantic backfill).
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
import type { SessionSummaryBackfillService } from '../../memory/sessionSummaryBackfillService';
import type { SessionSummaryService } from '../../memory/sessionSummaryService';

export interface PiSessionMemoryHost {
  getSessionSummaryService(): SessionSummaryService | null;
  getSessionSummaryBackfillService(): SessionSummaryBackfillService | null;
}

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

  async runPostTurnMaintenance(
    sessionId: string,
    workingDirectory: string,
    complete: SessionMemoryCompletion,
  ): Promise<void> {
    const sessionSummaryService = this.host.getSessionSummaryService();
    if (sessionSummaryService) {
      try {
        await sessionSummaryService.rollup({ sessionId, workingDirectory, complete });
      } catch (error) {
        console.warn(`[SessionSummary] Failed to roll up session ${sessionId}:`, error);
      }
    }
    const sessionSummaryBackfillService = this.host.getSessionSummaryBackfillService();
    if (sessionSummaryBackfillService) {
      try {
        await sessionSummaryBackfillService.run(complete);
      } catch (error) {
        console.warn('[SessionSummaryBackfill] Failed to run semantic backfill:', error);
      }
    }
  }
}
