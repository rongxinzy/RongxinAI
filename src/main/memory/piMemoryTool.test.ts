import { expect, test, vi } from 'vitest';

import { PiMemoryAction } from './constants';
import { buildPiProjectMemoryTool } from './piMemoryTool';

test('exposes only controlled project memory actions', async () => {
  const service = {
    recallProject: vi.fn(async () => [{ id: 7, title: 'Database', content: 'Use SQLite.' }]),
    recallPersonal: vi.fn(async () => []),
    saveProjectMemory: vi.fn(),
    proposePersonalMemory: vi.fn(),
    saveSessionSummary: vi.fn(),
  };
  const tool = buildPiProjectMemoryTool({
    service: service as never,
    sessionId: 'session-1',
    workingDirectory: '/workspace/project',
  }) as {
    parameters: { properties: { action: { enum: string[] } } };
    execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  expect(tool.parameters.properties.action.enum).toEqual(Object.values(PiMemoryAction));
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
