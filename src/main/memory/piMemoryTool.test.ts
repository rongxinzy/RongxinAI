import { expect, test, vi } from 'vitest';

import { PiMemoryAction } from './constants';
import { buildPiProjectMemoryTool } from './piMemoryTool';

test('exposes only controlled project memory actions', async () => {
  const service = {
    recallProject: vi.fn(async () => [{ id: 7, title: 'Database', content: 'Use SQLite.' }]),
    recallPersonal: vi.fn(async () => []),
    recallSession: vi.fn(async () => []),
    saveProjectMemory: vi.fn(),
    proposePersonalMemory: vi.fn(() => 'candidate-1'),
    saveSessionSummary: vi.fn(),
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
  const tool = buildPiProjectMemoryTool({
    service: service as never,
    sessionId: 'session-1',
    workingDirectory: '/workspace/project',
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
    title: 'Promoted preference',
    content: 'Carry the workspace preference into personal memory.',
    promotesMemoryId: 8,
    supersedesMemoryId: 9,
  });
  expect(proposalResult).toMatchObject({
    details: { candidateId: 'candidate-1', needsReview: true },
  });
  expect(service.proposePersonalMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      promotesMemoryId: 8,
      supersedesMemoryId: 9,
    }),
  );
});
