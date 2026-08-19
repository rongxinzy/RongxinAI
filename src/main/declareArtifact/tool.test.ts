import { expect, test, vi } from 'vitest';

import { buildDeclareArtifactTool, type DeclaredArtifactInput } from './tool';

type DeclareArtifactTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: Record<string, unknown>;
  }>;
};

test('forwards structured declarations to the artifact ledger', async () => {
  const onDeclare = vi.fn<(artifact: DeclaredArtifactInput) => void>();
  const tool = buildDeclareArtifactTool({ onDeclare }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', {
    filePath: 'D:/workspace/report.md',
    title: 'Final report',
    kind: 'markdown',
    role: 'deliverable',
  });

  expect(onDeclare).toHaveBeenCalledWith({
    filePath: 'D:/workspace/report.md',
    title: 'Final report',
    kind: 'markdown',
    role: 'deliverable',
  });
  expect(result.details).toMatchObject({ filePath: 'D:/workspace/report.md' });
});

test('reports ledger rejection instead of claiming the artifact was declared', async () => {
  const tool = buildDeclareArtifactTool({
    onDeclare: () => {
      throw new Error('path is outside the workspace');
    },
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', { filePath: 'D:/outside/report.md' });

  expect(result.content[0].text).toContain('Artifact declaration failed');
  expect(result.details.error).toBe('path is outside the workspace');
});
