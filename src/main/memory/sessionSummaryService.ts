import type { CoworkStore } from '../coworkStore';
import type { ProjectMemoryService } from './projectMemoryService';
import {
  SESSION_MEMORY_EXTRACTOR_VERSION,
  SessionMemoryExtractor,
  type SessionMemoryCompletion,
} from './sessionMemoryExtractor';

const MAX_SOURCE_MESSAGES = 32;

export interface SessionSummaryRollupInput {
  sessionId: string;
  workingDirectory: string;
  complete: SessionMemoryCompletion;
}

export class SessionSummaryService {
  private readonly pendingBySession = new Map<string, Promise<number | null>>();

  constructor(
    private readonly memoryService: ProjectMemoryService,
    private readonly coworkStore: CoworkStore,
    private readonly extractor = new SessionMemoryExtractor(),
  ) {}

  rollup(input: SessionSummaryRollupInput): Promise<number | null> {
    const previous = this.pendingBySession.get(input.sessionId) ?? Promise.resolve(null);
    const current = previous
      .catch((): null => null)
      .then(() => this.rollupNow(input))
      .finally(() => {
        if (this.pendingBySession.get(input.sessionId) === current) {
          this.pendingBySession.delete(input.sessionId);
        }
      });
    this.pendingBySession.set(input.sessionId, current);
    return current;
  }

  private async rollupNow(input: SessionSummaryRollupInput): Promise<number | null> {
    const session = this.coworkStore.getSession(input.sessionId, MAX_SOURCE_MESSAGES);
    if (!session) return null;
    const previousSummary = this.memoryService.getActiveSessionSummary({
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
    });
    const extracted = await this.extractor.extract({
      messages: session.messages,
      previousMemory:
        previousSummary?.metadata.extractorVersion === SESSION_MEMORY_EXTRACTOR_VERSION
          ? {
              digest: previousSummary.metadata.digest,
              sourceMessageIds: previousSummary.metadata.sourceMessageIds,
            }
          : undefined,
      complete: input.complete,
    });
    if (!extracted) return null;
    return await this.memoryService.saveSessionSummary({
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      summary: extracted.summary,
      metadata: extracted.metadata,
    });
  }
}
