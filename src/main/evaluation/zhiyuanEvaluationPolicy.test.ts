import { expect, test, vi } from 'vitest';
import { ZhiyuanEvaluationPolicyProtocolVersion, ZhiyuanEvaluationToolMode } from './constants';
import { createZhiyuanEvaluationPolicy } from './zhiyuanEvaluationPolicy';
import type { ZhiyuanEvaluationPolicyContext } from './types';

const context = (): ZhiyuanEvaluationPolicyContext => ({
  protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
  candidateId: 'candidate',
  runId: 'run',
  sampleId: 'sample',
  modelProfile: 'test',
  prompt: 'Complete the task',
  toolMode: ZhiyuanEvaluationToolMode.Execute,
  tools: [{ name: 'bash' }],
  metadata: {},
  candidateRoot: process.cwd(),
  workspace: process.cwd(),
  agentDir: process.cwd(),
  emitActivation: vi.fn(),
});

test('loads product resources without outer control tools or completion interception', async () => {
  const policy = await createZhiyuanEvaluationPolicy(context());
  expect(policy.systemPrompt).toContain('ZhiYuan Agent');
  expect(policy.skillPaths).toEqual(['SKILLs']);
  expect(policy.customTools).toBeUndefined();
  expect(policy.onAgentEnd).toBeUndefined();
  expect(policy.onEvent).toBeUndefined();
});

test('capture mode bypasses resource loading', async () => {
  const policy = await createZhiyuanEvaluationPolicy({
    ...context(),
    toolMode: ZhiyuanEvaluationToolMode.Capture,
    candidateRoot: '/does-not-exist',
  });
  expect(policy.systemPrompt).toBeUndefined();
});

test('rejects an incompatible bridge contract', async () => {
  await expect(
    createZhiyuanEvaluationPolicy({ ...context(), protocolVersion: '999' }),
  ).rejects.toThrow('Unsupported evaluation policy protocol');
});
