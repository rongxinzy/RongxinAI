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
  expect(shouldEnableProductionWorkflow(workRequest('Create an empty file.'))).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('把标题改成蓝色'))).toBe(false);
});

test('enables production workflow only for changes with production evidence', () => {
  expect(shouldEnableProductionWorkflow(workRequest('修复登录流程中的刷新问题'))).toBe(true);
  expect(
    shouldEnableProductionWorkflow(workRequest('Review this repository for regressions.')),
  ).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('先修改配置，然后运行测试'))).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('Can you fix the stale closure?'))).toBe(true);
  expect(
    shouldEnableProductionWorkflow(workRequest('Research reliable agent architectures.')),
  ).toBe(true);
});

test('uses explicit goal mode and inherited task policy as authoritative signals', () => {
  expect(shouldEnableProductionWorkflow({ ...workRequest('你好'), goalMode: true })).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Continue'),
      inheritedProductionWorkflow: true,
    }),
  ).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Build an application'),
      inheritedProductionWorkflow: false,
    }),
  ).toBe(false);
  expect(shouldEnableProductionWorkflow(workRequest('Handle the request'))).toBe(false);
});

test('does not let skills, experts, attachments, or old-task hints raise the gate', () => {
  const incidentalContext = {
    ...workRequest('继续'),
    skillIds: ['presentation-studio'],
    expertIds: ['reviewer'],
    imageAttachmentCount: 1,
    resumeRun: true,
  };
  expect(shouldEnableProductionWorkflow(incidentalContext)).toBe(false);
  expect(
    shouldEnableProductionWorkflow({
      ...incidentalContext,
      prompt: 'Read package.json',
    }),
  ).toBe(false);
});
