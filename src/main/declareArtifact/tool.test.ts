import { expect, test, vi } from 'vitest';

import { buildDeclareArtifactTool, type DeclaredArtifactInput } from './tool';

type DeclareArtifactTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: Record<string, unknown>;
  }>;
};

test('forwards structured declarations to the artifact ledger', async () => {
  const onDeclare = vi.fn<(artifact: DeclaredArtifactInput) => void>();
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => true,
  }) as unknown as DeclareArtifactTool;

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
    fileExists: async () => true,
    onDeclare: () => {
      throw new Error('path is outside the workspace');
    },
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', { filePath: 'D:/outside/report.md' });

  expect(result.content[0].text).toContain('Artifact declaration failed');
  expect(result.details.error).toContain('path is outside the workspace');
});

test('rejects declarations when the file does not exist', async () => {
  const onDeclare = vi.fn();
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => false,
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', {
    filePath: 'C:/Users/Administrator/scratch/missing.pptx',
  });

  expect(onDeclare).not.toHaveBeenCalled();
  expect(result.content[0].text).toContain('file does not exist');
  expect(result.details.isError).toBe(true);
});

test('fails fast when the pending write registry knows nothing of the path', async () => {
  const onDeclare = vi.fn();
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => false,
    awaitPendingWrite: async () => false,
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', { filePath: 'C:/tmp/missing.md' });

  expect(onDeclare).not.toHaveBeenCalled();
  expect(result.details.isError).toBe(true);
});

test('succeeds after waiting for a pending parallel write of the same file', async () => {
  const onDeclare = vi.fn();
  let fileMaterialized = false;
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => fileMaterialized,
    // The pending write settles asynchronously, then the file appears.
    awaitPendingWrite: async () => {
      fileMaterialized = true;
      return true;
    },
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', {
    filePath: 'C:/Users/Administrator/.zhiyuan/scratch/剑影残阳.md',
  });

  expect(onDeclare).toHaveBeenCalledWith({
    filePath: 'C:/Users/Administrator/.zhiyuan/scratch/剑影残阳.md',
    role: 'deliverable',
  });
  expect(result.details).toMatchObject({
    filePath: 'C:/Users/Administrator/.zhiyuan/scratch/剑影残阳.md',
  });
});

test('reports failure when a pending write settles without producing the file', async () => {
  const onDeclare = vi.fn();
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => false,
    awaitPendingWrite: async () => true,
  }) as unknown as DeclareArtifactTool;

  const result = await tool.execute('call-1', { filePath: 'C:/tmp/never-written.md' });

  expect(onDeclare).not.toHaveBeenCalled();
  expect(result.details.isError).toBe(true);
  expect(result.details.error).toContain('file does not exist');
});

test('an aborted declaration stops waiting on the pending write', async () => {
  const onDeclare = vi.fn();
  const tool = buildDeclareArtifactTool({
    onDeclare,
    fileExists: async () => false,
    // Never settles: only the abort signal may unblock the wait.
    awaitPendingWrite: () => new Promise<boolean>(() => {}),
  }) as unknown as DeclareArtifactTool;

  const controller = new AbortController();
  const pending = tool.execute('call-1', { filePath: 'C:/tmp/stuck.md' }, controller.signal);
  controller.abort();
  const result = await pending;

  expect(onDeclare).not.toHaveBeenCalled();
  expect(result.details.isError).toBe(true);
});
