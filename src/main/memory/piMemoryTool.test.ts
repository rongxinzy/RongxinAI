import { expect, test, vi } from 'vitest';

import { MemoryKind, MemorySensitivity } from '../../shared/memory';
import { PiMemoryAction } from './constants';
import { buildPiProjectMemoryTool } from './piMemoryTool';

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
  const extractedMemory = {
    title: 'Concise preference',
    content: 'Use SQLite for durable local state.',
    kind: MemoryKind.Preference,
    importance: 0.8,
    confidence: 0.9,
    sensitivity: MemorySensitivity.Normal,
    evidenceSourceIds: ['user-1'],
  };
  const extractor = {
    extract: vi.fn(async () => ({
      memories: [extractedMemory],
      metadataFor: vi.fn(() => ({ extractorVersion: 1, sourceIds: ['user-1'] })),
    })),
  };
  const tool = buildPiProjectMemoryTool({
    service: service as never,
    sessionId: 'session-1',
    workingDirectory: '/workspace/project',
    getMessages: () => [
      { id: 'user-1', type: 'user', content: 'Remember to use SQLite.', timestamp: 1 },
    ],
    complete: vi.fn(),
    extractor: extractor as never,
  }) as {
    parameters: {
      properties: {
        action: { enum: string[] };
        promotesMemoryId: { type: string };
        supersedesMemoryId: { type: string };
      };
    };
    execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  expect(tool.parameters.properties.action.enum).toEqual(Object.values(PiMemoryAction));
  expect(tool.parameters.properties.promotesMemoryId.type).toBe('number');
  expect(tool.parameters.properties.supersedesMemoryId.type).toBe('number');
  const result = await tool.execute('call-1', {
    action: PiMemoryAction.Recall,
    query: 'database',
  });
  expect(result).toMatchObject({ details: { count: 1 } });
  expect(service.recallProject).toHaveBeenCalledWith({
    workingDirectory: '/workspace/project',
    query: 'database',
  });
  expect(service.recallSession).toHaveBeenCalledWith({
    workingDirectory: '/workspace/project',
    sessionId: 'session-1',
    query: 'database',
  });

  const listResult = await tool.execute('call-2', { action: PiMemoryAction.List, limit: 5 });
  expect(listResult).toMatchObject({ details: { count: 1 } });
  expect(service.listRecallableMemories).toHaveBeenCalledWith({
    workingDirectory: '/workspace/project',
    sessionId: 'session-1',
    query: undefined,
    limit: 5,
  });

  const proposalResult = await tool.execute('call-3', {
    action: PiMemoryAction.ProposePersonal,
    promotesMemoryId: 8,
    supersedesMemoryId: 9,
    title: 'Raw title',
    content: 'Raw content that must be extracted.',
  });
  expect(proposalResult).toMatchObject({
    details: { candidateId: 'candidate-1', needsReview: true },
  });
  expect(extractor.extract).toHaveBeenCalledWith(
    expect.objectContaining({
      sources: expect.arrayContaining([
        expect.objectContaining({ id: 'memory:8' }),
        expect.objectContaining({ id: 'memory:9' }),
      ]),
    }),
  );
  expect(service.proposePersonalMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      promotesMemoryId: 8,
      supersedesMemoryId: 9,
      title: extractedMemory.title,
      content: extractedMemory.content,
      importance: extractedMemory.importance,
      confidence: extractedMemory.confidence,
      sensitivity: extractedMemory.sensitivity,
      metadata: { extractorVersion: 1, sourceIds: ['user-1'] },
    }),
  );

  const saveResult = await tool.execute('call-4', {
    action: PiMemoryAction.Save,
    title: 'Raw project title',
    content: 'Raw project content that must be extracted.',
  });
  expect(saveResult).toMatchObject({ details: { memoryId: 42 } });
  expect(service.saveProjectMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      title: extractedMemory.title,
      content: extractedMemory.content,
      metadata: { extractorVersion: 1, sourceIds: ['user-1'] },
    }),
  );
});
