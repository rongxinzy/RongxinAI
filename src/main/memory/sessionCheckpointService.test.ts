import { expect, test } from 'vitest';

import { composeCheckpointContent, recordCheckpointFallback } from './sessionCheckpointService';

test('checkpoint content keeps the structured sections without inventing facts', () => {
  const content = composeCheckpointContent({
    goal: '交付发票审核工作簿',
    instructions: '用户要求可编辑',
    discoveries: ['工具调用占满窗口会丢摘要'],
    accomplished: '生成并校验 5 张表',
    nextSteps: ['人工复核 17 项'],
    relevantFiles: [{ path: '/work/out.xlsx', role: 'deliverable' }],
  });
  expect(content).toContain('## Goal\n交付发票审核工作簿');
  expect(content).toContain('## Instructions\n用户要求可编辑');
  expect(content).toContain('- 工具调用占满窗口会丢摘要');
  expect(content).toContain('## Accomplished\n生成并校验 5 张表');
  expect(content).toContain('- /work/out.xlsx — deliverable');
});

test('fallback records the goal and raw answer only, marked unreviewed', async () => {
  const saved: Array<Record<string, unknown>> = [];
  await recordCheckpointFallback(
    {
      saveSessionSummary: async input => {
        saved.push(input);
        return 1;
      },
    } as never,
    {
      sessionId: 'session-1',
      workingDirectory: '/work',
      goal: '生成 xlsx',
      finalAnswer: '交付物见 [工作簿](C:/work/out.xlsx)',
      verificationStatus: 'unverified',
      artifactReferences: ['/work/out.xlsx'],
    },
  );
  expect(saved).toHaveLength(1);
  const input = saved[0] as { summary: string; metadata: Record<string, unknown> };
  expect(input.summary).toContain('## Goal\n生成 xlsx');
  expect(input.summary).toContain('Not a confirmed long-term fact');
  expect(input.summary).toContain('- /work/out.xlsx');
  expect(input.metadata.format).toBe('fallback-run-record');
  expect(input.metadata.reviewRequired).toBe(true);
});
