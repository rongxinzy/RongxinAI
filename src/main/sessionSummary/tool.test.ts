import { expect, test, vi } from 'vitest';

import { buildSessionSummaryTool } from './tool';

test('session_summary writes an agent-authored checkpoint with host identity', async () => {
  const saved: Array<Record<string, unknown>> = [];
  const tool = buildSessionSummaryTool({
    getProjectMemoryService: () =>
      ({
        saveSessionSummary: async (input: Record<string, unknown>) => {
          saved.push(input);
          return 1;
        },
      }) as never,
    sessionId: 'session-1',
    workingDirectory: '/work',
    runId: 'run-1',
    turnId: 'turn-1',
  });

  const result = await tool.execute('call-1', {
    goal: '生成 hello.html',
    accomplished: '创建并声明 hello.html',
    relevantFiles: [{ path: '/work/hello.html', role: 'deliverable' }],
  });
  expect(result.details.status).toBe('written');
  expect(saved).toHaveLength(1);
  const input = saved[0] as { summary: string; metadata: Record<string, unknown> };
  expect(input.summary).toContain('## Goal\n生成 hello.html');
  expect(input.summary).toContain('/work/hello.html — deliverable');
  expect(input.metadata.format).toBe('agent-checkpoint');
  expect(input.metadata.runId).toBe('run-1');
  expect(input.metadata.turnId).toBe('turn-1');
});

test('skip is an explicit valid outcome and requires a reason', async () => {
  const tool = buildSessionSummaryTool({
    getProjectMemoryService: () => ({ saveSessionSummary: vi.fn() }) as never,
    sessionId: 'session-1',
    workingDirectory: '/work',
  });
  const missingReason = await tool.execute('call-1', { skip: true });
  expect(missingReason.details.isError).toBe(true);
  const skipped = await tool.execute('call-2', { skip: true, reason: '纯问答，没有产物' });
  expect(skipped.details.status).toBe('skipped');
});

test('empty goal or accomplished is rejected instead of writing an empty checkpoint', async () => {
  const tool = buildSessionSummaryTool({
    getProjectMemoryService: () => ({ saveSessionSummary: vi.fn() }) as never,
    sessionId: 'session-1',
    workingDirectory: '/work',
  });
  const result = await tool.execute('call-1', { goal: '', accomplished: '' });
  expect(result.details.isError).toBe(true);
});
