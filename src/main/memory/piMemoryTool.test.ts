import { expect, test, vi } from 'vitest';

import { MemoryKind, MemoryScope, MemorySensitivity } from '../../shared/memory';
import { PiMemoryAction } from './constants';
import { buildPiProjectMemoryTool, extractRequestedMemoryForAutomaticSave } from './piMemoryTool';
import {
  EXPLICIT_MEMORY_DEFAULT_CONFIDENCE,
  EXPLICIT_MEMORY_DEFAULT_IMPORTANCE,
  EXPLICIT_MEMORY_SOURCE,
} from './explicitUserRequestedMemory';

function buildTool(
  service: Record<string, unknown>,
  extractor: { extract: ReturnType<typeof vi.fn> },
) {
  return buildPiProjectMemoryTool({
    service: service as never,
    sessionId: 'session-1',
    workingDirectory: '/workspace/project',
    getMessages: () => [
      { id: 'user-1', type: 'user', content: 'Remember to use SQLite.', timestamp: 1 },
    ],
    complete: vi.fn(),
    extractor: extractor as never,
  }) as {
    execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}

test('exposes only controlled project memory actions', async () => {
  const service = {
    recallProject: vi.fn(async () => [{ id: 7, title: 'Database', content: 'Use SQLite.' }]),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    saveProjectMemory: vi.fn(async () => 42),
    proposePersonalMemory: vi.fn(() => 'candidate-1'),
    getRecallableMemoryById: vi.fn(({ memoryId }: { memoryId: number }) => ({
      title: `Memory ${memoryId}`,
      content: `Existing content ${memoryId}`,
    })),
    listRecallableMemories: vi.fn(() => [
      {
        id: 'link-1',
        memoryId: 7,
        scope: 'project',
        title: 'Database',
        content: 'Use SQLite.',
      },
    ]),
  };
  const extractor = {
    extract: vi.fn(async () => null),
  };
  const tool = buildTool(service, extractor);

  const result = await tool.execute('call-1', {
    action: PiMemoryAction.Recall,
    query: 'database',
  });
  expect(result).toMatchObject({ details: { count: 1 } });
  expect(service.recallProject).toHaveBeenCalledWith({
    workingDirectory: '/workspace/project',
    query: 'database',
  });
});

test('explicit save persists without calling the extractor when it would return null', async () => {
  const service = {
    recallProject: vi.fn(async () => []),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    saveProjectMemory: vi.fn(async () => 42),
    proposePersonalMemory: vi.fn(() => 'candidate-1'),
    getRecallableMemoryById: vi.fn(),
    listRecallableMemories: vi.fn(() => []),
  };
  const extractor = { extract: vi.fn(async () => null) };
  const tool = buildTool(service, extractor);

  const saveResult = await tool.execute('call-save', {
    action: PiMemoryAction.Save,
    title: '  Team   decision  ',
    content: '  Adopt   SQLite   for   local   state.  ',
  });

  expect(saveResult).toMatchObject({ details: { memoryId: 42 } });
  expect(extractor.extract).not.toHaveBeenCalled();
  expect(service.saveProjectMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Team decision',
      content: 'Adopt SQLite for local state.',
      importance: EXPLICIT_MEMORY_DEFAULT_IMPORTANCE,
      confidence: EXPLICIT_MEMORY_DEFAULT_CONFIDENCE,
      sensitivity: MemorySensitivity.Normal,
      metadata: { source: EXPLICIT_MEMORY_SOURCE },
    }),
  );
});

test('explicit personal proposal skips the extractor veto', async () => {
  const service = {
    recallProject: vi.fn(async () => []),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    saveProjectMemory: vi.fn(async () => 42),
    proposePersonalMemory: vi.fn(() => 'candidate-1'),
    getRecallableMemoryById: vi.fn(),
    listRecallableMemories: vi.fn(() => []),
  };
  const extractor = { extract: vi.fn(async () => null) };
  const tool = buildTool(service, extractor);

  const proposalResult = await tool.execute('call-propose', {
    action: PiMemoryAction.ProposePersonal,
    title: 'Personal preference',
    content: 'Prefer dark mode in every workspace.',
  });

  expect(proposalResult).toMatchObject({
    details: { candidateId: 'candidate-1', needsReview: true },
  });
  expect(extractor.extract).not.toHaveBeenCalled();
  expect(service.proposePersonalMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Personal preference',
      content: 'Prefer dark mode in every workspace.',
      metadata: { source: EXPLICIT_MEMORY_SOURCE },
    }),
  );
});

test('automatic extraction still filters null extractor results', async () => {
  const service = {
    getRecallableMemoryById: vi.fn(),
  };
  const extractor = { extract: vi.fn(async () => null) };
  const result = await extractRequestedMemoryForAutomaticSave(
    extractor as never,
    MemoryScope.Project,
    {
      title: 'Candidate title',
      content: 'Candidate content that should not bypass durability checks.',
      kind: MemoryKind.Decision,
    },
    {
      service: service as never,
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      getMessages: () => [
        { id: 'user-1', type: 'user', content: 'Remember this decision.', timestamp: 1 },
      ],
      complete: vi.fn(),
    },
  );
  expect(result).toBeNull();
  expect(extractor.extract).toHaveBeenCalled();
});

test('explicit save returns a clear error for empty content after normalization', async () => {
  const service = {
    saveProjectMemory: vi.fn(async () => 42),
    getRecallableMemoryById: vi.fn(),
    listRecallableMemories: vi.fn(() => []),
    recallProject: vi.fn(async () => []),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    proposePersonalMemory: vi.fn(),
  };
  const extractor = { extract: vi.fn(async () => null) };
  const tool = buildTool(service, extractor);

  const saveResult = await tool.execute('call-empty', {
    action: PiMemoryAction.Save,
    title: 'Private only',
    content: '<private>secret-only</private>',
  });

  expect(saveResult).toMatchObject({
    details: { isError: true, reason: 'empty_content' },
  });
  expect(service.saveProjectMemory).not.toHaveBeenCalled();
});

test('explicit save reports when memory service queues the write', async () => {
  const service = {
    saveProjectMemory: vi.fn(async () => null),
    getRecallableMemoryById: vi.fn(),
    listRecallableMemories: vi.fn(() => []),
    recallProject: vi.fn(async () => []),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    proposePersonalMemory: vi.fn(),
  };
  const extractor = { extract: vi.fn(async () => null) };
  const tool = buildTool(service, extractor);

  const saveResult = await tool.execute('call-queued', {
    action: PiMemoryAction.Save,
    title: 'Queued decision',
    content: 'Use SQLite for durable local state.',
  });

  expect(saveResult).toMatchObject({
    details: { queued: true, reason: 'memory_unavailable' },
  });
  expect(String(saveResult.content[0].text)).toContain('queued');
});
