import { createHash, randomUUID } from 'node:crypto';
import { MemoryLifecycleStatus, MemoryScope, type ManagedMemoryRecord } from '../../shared/memory';
import type {
  MemoryBackend,
  MemoryCandidateInput,
  MemoryRecallInput,
  MemorySessionObserver,
} from './memoryBackendTypes';
import { MarkdownMemoryRuntime, type MemoryMaintenanceBudget } from './markdownMemoryRuntime';
import type { Context } from '@earendil-works/chord/context';
import { protectMemoryCuration } from './markdownMemoryCuration';
import { MemorySearchMatchMode } from './constants';
import { redactPrivateBlocks } from './privateBlocks';
import type { MemoryRepository } from './repository';
import type { MemoryCandidate, MemoryObservation } from './types';

export function markdownMemoryId(operationId: string): number {
  return Number.parseInt(createHash('sha256').update(operationId).digest('hex').slice(0, 13), 16);
}

function marker(id: number): string {
  return `[memory:${id}]`;
}
function entry(candidate: Pick<MemoryCandidate, 'title' | 'content'>, id: number): string {
  return `${marker(id)} ${candidate.title.replace(/\r?\n/g, ' ')}\n${candidate.content}`;
}

/** Product governance adapter over upstream files, with no secondary index. */
export class MarkdownMemoryBackend implements MemoryBackend {
  private readonly cleanups = new Map<string, Promise<void>>();
  constructor(
    readonly runtime: MarkdownMemoryRuntime,
    private readonly repository: MemoryRepository,
  ) {}

  saveCandidate(input: MemoryCandidateInput): MemoryCandidate {
    return {
      ...input,
      id: randomUUID(),
      title: redactPrivateBlocks(input.title),
      content: redactPrivateBlocks(input.content),
      createdAt: new Date().toISOString(),
    };
  }

  async confirmMemory(
    candidate: MemoryCandidate,
    _directory: string,
    observer?: MemorySessionObserver,
  ) {
    const id = markdownMemoryId(candidate.operationId ?? candidate.id);
    // Checkpoints remain application records, not long-term facts. Durable owns
    // the transcript, and the existing immutable checkpoint/outbox owns its receipt.
    if (candidate.scope === MemoryScope.Session) {
      observer?.(candidate.sessionId);
      return id;
    }
    const files = await this.runtime.files(candidate.project);
    const file = candidate.scope === MemoryScope.Personal ? 'user' : 'memory';
    const current = await files.read(file);
    const previous = current.entries.find(value => value.startsWith(`${marker(id)} `));
    const next = entry(candidate, id);
    if (previous && previous !== next)
      throw new Error('Memory operation was reused with different input.');
    const governed = candidate.operationId ? this.repository.getLink(candidate.operationId) : null;
    if (!previous && (!governed || governed.status === MemoryLifecycleStatus.Active)) {
      await files.apply(file, [{ op: 'add', text: next }], { reviewId: candidate.operationId });
    }
    observer?.(candidate.sessionId, Boolean(previous));
    return id;
  }

  async resumeSession(localId: string): Promise<string> {
    return localId;
  }

  async finalizeSession(input: { sessionId: string; project: string; summary: string }) {
    // No external memory session exists. This acknowledges only the product's
    // local close intent, without creating another summary or plugin memory.
    return {
      sessionId: input.sessionId,
      state: 'finalized',
      summaryId: markdownMemoryId(`finalize:${input.project}:${input.sessionId}`),
      alreadyFinalized: false,
    };
  }

  async supersede(input: {
    observationId: number;
    candidate: MemoryCandidate;
    workingDirectory: string;
    onRuntimeSession?: MemorySessionObserver;
  }) {
    const candidate = input.candidate;
    if (candidate.scope === MemoryScope.Session)
      return this.confirmMemory(candidate, input.workingDirectory, input.onRuntimeSession);
    const files = await this.runtime.files(candidate.project);
    const file = candidate.scope === MemoryScope.Personal ? 'user' : 'memory';
    const current = await files.read(file);
    const id = markdownMemoryId(candidate.operationId ?? candidate.id);
    const previous = current.entries.find(value =>
      value.startsWith(`${marker(input.observationId)} `),
    );
    const saved = current.entries.find(value => value.startsWith(`${marker(id)} `));
    if (!saved)
      await files.apply(
        file,
        previous
          ? [{ op: 'replace', match: previous, text: entry(candidate, id) }]
          : [{ op: 'add', text: entry(candidate, id) }],
        { reviewId: candidate.operationId },
      );
    input.onRuntimeSession?.(candidate.sessionId, Boolean(saved));
    return id;
  }

  async forget(id: number, hardDelete: boolean, owner?: string): Promise<boolean> {
    if (!owner) throw new Error('A trusted memory project is required.');
    const link = this.repository.findLinkByMemoryId(id);
    if (link && link.projectId !== owner) throw new Error('Memory belongs to another project.');
    const files = await this.runtime.files(owner);
    for (const file of ['user', 'memory'] as const) {
      const current = await files.read(file);
      const target = current.entries.find(value => value.startsWith(`${marker(id)} `));
      if (target) await files.apply(file, [{ op: 'remove', match: target }]);
    }
    if (hardDelete) await this.runtime.purgeUndoHistory(owner);
    return true;
  }

  async maintain(owner: string, budget: MemoryMaintenanceBudget, context: Context) {
    const files = await this.runtime.files(owner);
    const current = await files.read('memory');
    const protectedBudget = protectMemoryCuration(budget, current.entries);
    const result = await this.runtime.maintain(owner, protectedBudget, context);
    if (result.changes.length) {
      const entries = (await files.read('memory')).entries;
      for (const record of this.repository.listManaged({
        projectIds: [owner],
        scope: MemoryScope.Project,
        status: MemoryLifecycleStatus.Active,
      })) {
        const value = entries.find(value => value.startsWith(`${marker(record.memoryId!)} `));
        if (!value) this.repository.setLinkStatus(record.id, MemoryLifecycleStatus.Archived);
        else {
          const [title, ...body] = value.slice(marker(record.memoryId!).length + 1).split('\n');
          this.repository.updateNativeMemoryProjection(record.id, title, body.join('\n'));
        }
      }
    }
    return result;
  }

  async recall(input: MemoryRecallInput): Promise<MemoryObservation[]> {
    const terms = input.query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
    return (await this.recent({ ...input, limit: 20 }))
      .filter(record => {
        const text = `${record.title}\n${record.content}`.toLocaleLowerCase();
        return input.matchMode === MemorySearchMatchMode.Any
          ? terms.some(term => text.includes(term))
          : terms.every(term => text.includes(term));
      })
      .slice(0, input.limit ?? 8);
  }

  async recent(
    input: Omit<MemoryRecallInput, 'query' | 'matchMode'>,
  ): Promise<MemoryObservation[]> {
    input.signal?.throwIfAborted();
    const scope = input.scope ?? MemoryScope.Project;
    const records = this.repository
      .listManaged({ projectIds: [input.project], scope, status: MemoryLifecycleStatus.Active })
      .filter(record => record.memoryId !== null);
    if (scope === MemoryScope.Session)
      return records.map(record => this.observation(record)).slice(0, input.limit ?? 8);
    await this.removeInactive(input.project);
    const files = await this.runtime.files(input.project);
    const read = await files.read(scope === MemoryScope.Personal ? 'user' : 'memory');
    const present = new Map(
      read.entries.map(value => [/^\[memory:(\d+)\]/.exec(value)?.[1], value]),
    );
    return records
      .filter(record => present.has(String(record.memoryId)))
      .map(record => {
        const value = present.get(String(record.memoryId))!;
        const [title, ...body] = value.slice(marker(record.memoryId!).length + 1).split('\n');
        return { ...this.observation(record), title, content: body.join('\n') };
      })
      .slice(0, input.limit ?? 8);
  }

  /** Purges expired/archived governed entries before native section rendering. */
  async removeInactive(owner: string): Promise<void> {
    const pending = (this.cleanups.get(owner) ?? Promise.resolve())
      .catch((): void => {})
      .then(() => this.removeInactiveEntries(owner));
    this.cleanups.set(owner, pending);
    try {
      await pending;
    } finally {
      if (this.cleanups.get(owner) === pending) this.cleanups.delete(owner);
    }
  }

  private async removeInactiveEntries(owner: string): Promise<void> {
    const records = this.repository.listManaged({ projectIds: [owner] });
    const inactive = new Set(
      records
        .filter(record => record.status !== MemoryLifecycleStatus.Active)
        .map(record => record.memoryId)
        .filter(id => id !== null),
    );
    if (!inactive.size) return;
    const files = await this.runtime.files(owner);
    for (const file of ['user', 'memory'] as const) {
      const current = await files.read(file);
      const ops = current.entries.flatMap(value => {
        const match = /^\[memory:(\d+)\]/.exec(value);
        return match && inactive.has(Number(match[1]))
          ? [{ op: 'remove' as const, match: value }]
          : [];
      });
      if (ops.length) await files.apply(file, ops);
    }
  }

  private observation(record: ManagedMemoryRecord): MemoryObservation {
    return {
      id: record.memoryId!,
      sync_id: record.id,
      session_id: record.sessionId,
      project: record.projectId,
      scope: record.scope,
      type: record.kind,
      title: record.title,
      content: record.content,
      topic_key: record.topicKey ?? undefined,
      revision_count: 1,
      duplicate_count: 0,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    };
  }
}
