import { expect, test } from 'vitest';

import { CoworkSessionMode } from '../../shared/cowork/constants';
import { shouldEnableProductionWorkflow } from './entryPolicy';

const workRequest = (prompt: string) => ({ sessionMode: CoworkSessionMode.Work, prompt });

test('bypasses production workflow for Chat mode and empty Work prompts', () => {
  expect(
    shouldEnableProductionWorkflow({ sessionMode: CoworkSessionMode.Chat, prompt: 'Build an app' }),
  ).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('  '))).toBe(false);
  expect(shouldEnableProductionWorkflow({ prompt: 'Build an app' })).toBe(true);
});

test('bypasses production workflow for simple conversation and information requests', () => {
  expect(shouldEnableProductionWorkflow(workRequest('你好'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('为什么天空是蓝色的？'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('Explain how event loops work.'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('什么是单元测试？'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('How do I fix a stale closure?'))).toBe(false);
});

test('bypasses production workflow for explicit lightweight one-step tasks', () => {
  expect(shouldEnableProductionWorkflow(workRequest('计算 17 * 23'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('列出当前目录'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('Translate this sentence to Chinese.'))).toBe(
    false,
  );
  expect(shouldEnableProductionWorkflow(workRequest('你好，帮我翻译这句话'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('当前时间'))).toBe(false);
});

test('retains production workflow for changes and scoped reviews', () => {
  expect(shouldEnableProductionWorkflow(workRequest('修复登录流程中的刷新问题'))).toBe(true);
  expect(
    shouldEnableProductionWorkflow(workRequest('Review this repository for regressions.')),
  ).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('先修改配置，然后运行测试'))).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('Can you fix the stale closure?'))).toBe(true);
});

test('retains production workflow for explicit signals and ambiguous Work requests', () => {
  expect(shouldEnableProductionWorkflow({ ...workRequest('你好'), goalMode: true })).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Review this repository'),
      skillIds: ['code-review'],
    }),
  ).toBe(true);
  expect(shouldEnableProductionWorkflow({ ...workRequest('Continue'), resumeRun: true })).toBe(
    true,
  );
  expect(shouldEnableProductionWorkflow(workRequest('Handle the request'))).toBe(true);
});

test('does not let a selected skill override an explicitly lightweight turn', () => {
  expect(
    shouldEnableProductionWorkflow({ ...workRequest('你好'), skillIds: ['presentation-studio'] }),
  ).toBe(false);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Read package.json'),
      skillIds: ['code-review'],
    }),
  ).toBe(false);
});

test('keeps continuations and revisions inside an existing skilled workflow', () => {
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('继续'),
      skillIds: ['presentation-studio'],
    }),
  ).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('把标题改成蓝色'),
      skillIds: ['presentation-studio'],
    }),
  ).toBe(true);
});
