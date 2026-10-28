import { expect, test, vi } from 'vitest';

import { MemoryScope } from '../../shared/memory';
import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { ProjectMemoryService } from './projectMemoryService';
import type { MemoryOutboxItem } from './repository';

class FakeRepository {
  items: MemoryOutboxItem[] = [];
  links: Array<Record<string, unknown>> = [];

  enqueue(operation: MemoryOutboxOperation, payload: Record<string, unknown>) {
    const id = `outbox-${this.items.length + 1}`;
    this.items.push({
      id,
      operation,
      payload,
      status: MemoryOutboxStatus.Pending,
      attempts: 0,
      availableAt: new Date(0).toISOString(),
      lastError: null,
    });
    return id;
  }

  findPendingByLinkId() {
    return null;
  }

  listPending() {
    return this.items.filter(item => item.status === MemoryOutboxStatus.Pending);
  }

  findActiveTopic() {
    return null;
  }

  getLink() {
    return null;
  }

  getLinkMetadata() {
    return {};
  }

  createLink(input: Record<string, unknown>) {
    this.links.push(input);
    return String(input.id);
  }

  supersedeActiveTopic() {}

  deleteCandidate() {}

  setLinkStatus() {}

  markCompleted(id: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) item.status = MemoryOutboxStatus.Completed;
  }

  markRetry() {}

  maxSessionCheckpointSequence(): number {
    let max = 0;
    for (const link of this.links) {
      const metadata = link.metadata as { checkpointSequence?: number } | undefined;
      if (typeof metadata?.checkpointSequence === 'number') {
        max = Math.max(max, metadata.checkpointSequence);
      }
    }
    return max;
  }
}

const identityFor = (cwd: string) => ({ id: `project-${cwd}`, displayName: cwd, root: cwd });

function summaryPayload(sequence: number): MemoryOutboxItem {
  return {
    id: 'outbox-legacy',
    operation: MemoryOutboxOperation.SessionSummary,
    payload: {
      sessionId: 'session-1',
      projectId: 'project-/work',
      projectRoot: '/work',
      type: 'session_summary',
      title: 'Session summary',
      content: 'older checkpoint',
      topicKey: 'session/session-1',
      sourceKind: 'session_summary',
      scope: MemoryScope.Session,
      linkId: 'link-legacy',
      metadata: { checkpointSequence: sequence },
    },
    status: MemoryOutboxStatus.Pending,
    attempts: 0,
    availableAt: new Date(0).toISOString(),
    lastError: null,
  };
}

test('checkpoints get a per-session increasing sequence', async () => {
  const repository = new FakeRepository();
  const confirmMemory = vi.fn(async () => 1);
  const saveCandidate = vi.fn(() => ({ id: 'candidate-1' }));
  const service = new ProjectMemoryService(
    repository as never,
    { saveCandidate, confirmMemory } as never,
    identityFor,
    '/tmp',
  );

  await service.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'first checkpoint',
    metadata: { format: 'agent-checkpoint' },
  });
  await service.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'second checkpoint',
    metadata: { format: 'agent-checkpoint' },
  });

  const sequences = repository.links.map(
    link => (link.metadata as { checkpointSequence?: number }).checkpointSequence,
  );
  expect(sequences).toEqual([1, 2]);
});

test('an older retry cannot overwrite a newer checkpoint', async () => {
  const repository = new FakeRepository();
  repository.links.push({
    id: 'link-newer',
    memoryId: 1,
    metadata: { checkpointSequence: 2 },
  });
  const confirmMemory = vi.fn(async () => 1);
  repository.items.push(summaryPayload(1));

  await processMemoryOutboxItem(repository as never, { confirmMemory } as never, summaryPayload(1));

  expect(confirmMemory).not.toHaveBeenCalled();
  expect(repository.items[0].status).toBe(MemoryOutboxStatus.Completed);
});
