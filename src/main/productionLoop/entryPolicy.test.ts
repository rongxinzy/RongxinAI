import { expect, test } from 'vitest';

import { CoworkSessionMode } from '../../shared/cowork/constants';
import { shouldEnableProductionLoop } from './entryPolicy';

const workRequest = (prompt: string) => ({ sessionMode: CoworkSessionMode.Work, prompt });

test('bypasses production loop for Chat mode and empty Work prompts', () => {
  expect(
    shouldEnableProductionLoop({ sessionMode: CoworkSessionMode.Chat, prompt: 'Build an app' }),
  ).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('  '))).toBe(false);
});

test('bypasses production loop for simple conversation and information requests', () => {
  expect(shouldEnableProductionLoop(workRequest('你好'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('为什么天空是蓝色的？'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('Explain how event loops work.'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('什么是单元测试？'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('How do I fix a stale closure?'))).toBe(false);
});

test('bypasses production loop for explicit lightweight one-step tasks', () => {
  expect(shouldEnableProductionLoop(workRequest('计算 17 * 23'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('列出当前目录'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('Translate this sentence to Chinese.'))).toBe(
    false,
  );
  expect(shouldEnableProductionLoop(workRequest('你好，帮我翻译这句话'))).toBe(false);
  expect(shouldEnableProductionLoop(workRequest('当前时间'))).toBe(false);
});

test('retains production loop for changes and scoped reviews', () => {
  expect(shouldEnableProductionLoop(workRequest('修复登录流程中的刷新问题'))).toBe(true);
  expect(shouldEnableProductionLoop(workRequest('Review this repository for regressions.'))).toBe(
    true,
  );
  expect(shouldEnableProductionLoop(workRequest('先修改配置，然后运行测试'))).toBe(true);
  expect(shouldEnableProductionLoop(workRequest('Can you fix the stale closure?'))).toBe(true);
});

test('retains production loop for explicit workflow signals and ambiguous Work requests', () => {
  expect(shouldEnableProductionLoop({ ...workRequest('你好'), goalMode: true })).toBe(true);
  expect(shouldEnableProductionLoop({ ...workRequest('你好'), skillIds: ['code-review'] })).toBe(
    true,
  );
  expect(shouldEnableProductionLoop({ ...workRequest('Continue'), resumeRun: true })).toBe(true);
  expect(shouldEnableProductionLoop(workRequest('Handle the request'))).toBe(true);
});
