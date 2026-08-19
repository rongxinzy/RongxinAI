import type { CoworkMessage, CoworkStore } from '../coworkStore';
import {
  SESSION_SUMMARY_BACKFILL_VERSION,
  SessionSummaryBackfillStatus,
  type SessionSummaryBackfillStatus as SessionSummaryBackfillStatusValue,
} from './constants';
import type { ProjectMemoryService } from './projectMemoryService';
import type { MemoryMigrationRecord } from './repository';
import {
  SessionMemoryExtractor,
  SessionMemorySourceRole,
  type SessionMemoryCompletion,
  type SessionMemoryExtractionResult,
} from './sessionMemoryExtractor';

const MAX_SOURCE_MESSAGES_PER_BATCH = 12;
const BACKFILL_METADATA_KEY = 'sessionSummaryBackfill';

interface SessionSummaryBackfillState {
  version: number;
  status: SessionSummaryBackfillStatusValue;
  sourceMessageCount: number;
  updatedAt: string;
  replacementLinkId?: string;
  error?: string;
}

export interface SessionSummaryBackfillResult {
  completed: number;
  deferred: number;
  failed: number;
  retained: number;
}

export class SessionSummaryBackfillService {
  private pending: Promise<SessionSummaryBackfillResult> | null = null;

  constructor(
    private readonly memoryService: ProjectMemoryService,
    private readonly coworkStore: CoworkStore,
    private readonly extractor = new SessionMemoryExtractor(),
  ) {}

  run(complete: SessionMemoryCompletion): Promise<SessionSummaryBackfillResult> {
    if (this.pending) return this.pending;
    this.pending = this.runNow(complete).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async runNow(complete: SessionMemoryCompletion): Promise<SessionSummaryBackfillResult> {
    await this.memoryService.drainOutbox();
    const result: SessionSummaryBackfillResult = {
      completed: 0,
      deferred: 0,
      failed: 0,
      retained: 0,
    };
    for (const record of this.memoryService.listSessionSummaryBackfillRecords()) {
      await this.backfillRecord(record, complete, result);
    }
    return result;
  }

  private async backfillRecord(
    record: MemoryMigrationRecord,
    complete: SessionMemoryCompletion,
    result: SessionSummaryBackfillResult,
  ): Promise<void> {
    const priorState = parseBackfillState(record.metadata);
    if (
      priorState?.version === SESSION_SUMMARY_BACKFILL_VERSION &&
      priorState.status === SessionSummaryBackfillStatus.DeliveryPending
    ) {
      result.deferred += 1;
      return;
    }

    const session = this.coworkStore.getSession(record.memory.sessionId, null);
    const batches = session ? buildSessionSummaryBackfillBatches(session.messages) : [];
    const sourceMessageCount = batches.reduce((count, batch) => count + batch.length, 0);
    if (shouldRetainTerminalState(priorState, sourceMessageCount)) {
      result.retained += 1;
      return;
    }
    if (!session || !session.cwd.trim() || batches.length === 0) {
      this.updateState(record, {
        status: SessionSummaryBackfillStatus.EvidenceUnavailable,
        sourceMessageCount,
      });
      result.retained += 1;
      return;
    }

    try {
      let extracted: SessionMemoryExtractionResult | null = null;
      for (const messages of batches) {
        const next = await this.extractor.extract({
          messages,
          previousMemory: extracted
            ? {
                digest: extracted.metadata.digest,
                sourceMessageIds: extracted.metadata.sourceMessageIds,
              }
            : undefined,
          complete,
        });
        if (next) extracted = next;
      }
      if (!extracted) {
        this.updateState(record, {
          status: SessionSummaryBackfillStatus.RetainedNoReplacement,
          sourceMessageCount,
        });
        result.retained += 1;
        return;
      }

      const replacementLinkId = buildReplacementLinkId(record.memory.id);
      this.updateState(record, {
        status: SessionSummaryBackfillStatus.DeliveryPending,
        sourceMessageCount,
        replacementLinkId,
      });
      const memoryId = await this.memoryService.saveSessionSummary({
        sessionId: record.memory.sessionId,
        workingDirectory: session.cwd,
        summary: extracted.summary,
        linkId: replacementLinkId,
        metadata: {
          ...extracted.metadata,
          backfillVersion: SESSION_SUMMARY_BACKFILL_VERSION,
          migratedFromLinkId: record.memory.id,
        },
      });
      if (memoryId === null) {
        result.deferred += 1;
        return;
      }
      this.updateState(record, {
        status: SessionSummaryBackfillStatus.Completed,
        sourceMessageCount,
        replacementLinkId,
      });
      result.completed += 1;
    } catch (error) {
      this.updateState(record, {
        status: SessionSummaryBackfillStatus.Failed,
        sourceMessageCount,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  }

  private updateState(
    record: MemoryMigrationRecord,
    state: Omit<SessionSummaryBackfillState, 'version' | 'updatedAt'>,
  ): void {
    const nextState: SessionSummaryBackfillState = {
      version: SESSION_SUMMARY_BACKFILL_VERSION,
      updatedAt: new Date().toISOString(),
      ...state,
    };
    this.memoryService.updateMigrationRecordMetadata(record, {
      ...record.metadata,
      [BACKFILL_METADATA_KEY]: nextState,
    });
    record.metadata = {
      ...record.metadata,
      [BACKFILL_METADATA_KEY]: nextState,
    };
  }
}

export function buildSessionSummaryBackfillBatches(messages: CoworkMessage[]): CoworkMessage[][] {
  const exchanges: CoworkMessage[][] = [];
  let exchange: CoworkMessage[] = [];
  for (const message of messages) {
    if (!isSourceMessage(message)) continue;
    if (
      message.type === SessionMemorySourceRole.User &&
      exchange.some(item => item.type === SessionMemorySourceRole.User) &&
      exchange.some(item => item.type === SessionMemorySourceRole.Assistant)
    ) {
      exchanges.push(limitExchange(exchange));
      exchange = [];
    }
    if (exchange.length > 0 || message.type === SessionMemorySourceRole.User) {
      exchange.push(message);
    }
  }
  if (
    exchange.some(item => item.type === SessionMemorySourceRole.User) &&
    exchange.some(item => item.type === SessionMemorySourceRole.Assistant)
  ) {
    exchanges.push(limitExchange(exchange));
  }

  const batches: CoworkMessage[][] = [];
  let batch: CoworkMessage[] = [];
  for (const next of exchanges) {
    if (batch.length > 0 && batch.length + next.length > MAX_SOURCE_MESSAGES_PER_BATCH) {
      batches.push(batch);
      batch = [];
    }
    batch.push(...next);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function isSourceMessage(message: CoworkMessage): boolean {
  return (
    (message.type === SessionMemorySourceRole.User ||
      message.type === SessionMemorySourceRole.Assistant) &&
    message.metadata?.isThinking !== true &&
    message.content.trim().length > 0
  );
}

function limitExchange(messages: CoworkMessage[]): CoworkMessage[] {
  if (messages.length <= MAX_SOURCE_MESSAGES_PER_BATCH) return messages;
  const user = messages.find(message => message.type === SessionMemorySourceRole.User);
  return user
    ? [user, ...messages.slice(-(MAX_SOURCE_MESSAGES_PER_BATCH - 1))]
    : messages.slice(-MAX_SOURCE_MESSAGES_PER_BATCH);
}

function parseBackfillState(metadata: Record<string, unknown>): SessionSummaryBackfillState | null {
  const value = metadata[BACKFILL_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.version !== 'number' ||
    typeof state.status !== 'string' ||
    typeof state.sourceMessageCount !== 'number' ||
    typeof state.updatedAt !== 'string'
  ) {
    return null;
  }
  return state as unknown as SessionSummaryBackfillState;
}

function shouldRetainTerminalState(
  state: SessionSummaryBackfillState | null,
  sourceMessageCount: number,
): boolean {
  if (
    !state ||
    state.version !== SESSION_SUMMARY_BACKFILL_VERSION ||
    state.sourceMessageCount !== sourceMessageCount
  ) {
    return false;
  }
  return (
    state.status === SessionSummaryBackfillStatus.EvidenceUnavailable ||
    state.status === SessionSummaryBackfillStatus.RetainedNoReplacement
  );
}

function buildReplacementLinkId(legacyLinkId: string): string {
  return `session-summary-backfill:${SESSION_SUMMARY_BACKFILL_VERSION}:${legacyLinkId}`;
}
