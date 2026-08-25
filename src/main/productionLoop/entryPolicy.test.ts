import { expect, test } from 'vitest';

import { CoworkSessionMode } from '../../shared/cowork/constants';
import { shouldAutoSkipDirectConversation, shouldEnableProductionWorkflow } from './entryPolicy';

const workRequest = (prompt: string) => ({ sessionMode: CoworkSessionMode.Work, prompt });

test('offers the model a production workflow decision for every new Work turn', () => {
  expect(shouldEnableProductionWorkflow(workRequest('你好'))).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('为什么天空是蓝色的？'))).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('预测一下五粮液走向'))).toBe(true);
  expect(shouldEnableProductionWorkflow(workRequest('Create and validate a release report'))).toBe(
    true,
  );
  expect(shouldEnableProductionWorkflow({ prompt: 'Handle the request' })).toBe(true);
});

test('keeps Chat mode outside the production workflow', () => {
  expect(
    shouldEnableProductionWorkflow({
      sessionMode: CoworkSessionMode.Chat,
      prompt: 'Create and validate a release report',
      goalMode: true,
    }),
  ).toBe(false);
});

test('uses the owning task policy for explicit resume and retry operations', () => {
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Continue'),
      inheritedProductionWorkflow: true,
    }),
  ).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...workRequest('Continue'),
      inheritedProductionWorkflow: false,
    }),
  ).toBe(false);
});

test('does not classify natural-language intent or incidental resources', () => {
  const incidentalContext = {
    ...workRequest('继续'),
    skillIds: ['presentation-studio'],
    expertIds: ['reviewer'],
    imageAttachmentCount: 1,
    resumeRun: true,
  };
  expect(shouldEnableProductionWorkflow(incidentalContext)).toBe(true);
  expect(
    shouldEnableProductionWorkflow({
      ...incidentalContext,
      prompt: 'Read package.json',
    }),
  ).toBe(true);
});

test.each(['哈喽', '你好！', '您好', '谢谢', '收到', 'hello', 'got it'])(
  'auto-skips an exact direct-conversation turn: %s',
  prompt => {
    expect(shouldAutoSkipDirectConversation(workRequest(prompt))).toBe(true);
  },
);

test.each(['你好，删除这个文件', '谢谢，继续执行', '为什么天空是蓝色的？', '可以？'])(
  'keeps ambiguous or substantive text in the model decision path: %s',
  prompt => {
    expect(shouldAutoSkipDirectConversation(workRequest(prompt))).toBe(false);
  },
);

test('disables the direct-conversation fast path when runtime context may carry work', () => {
  const greeting = workRequest('你好');
  expect(
    shouldAutoSkipDirectConversation({ ...greeting, sessionMode: CoworkSessionMode.Chat }),
  ).toBe(false);
  expect(shouldAutoSkipDirectConversation({ ...greeting, goalMode: true })).toBe(false);
  expect(shouldAutoSkipDirectConversation({ ...greeting, inheritedProductionWorkflow: true })).toBe(
    false,
  );
  expect(
    shouldAutoSkipDirectConversation({ ...greeting, inheritedProductionWorkflow: false }),
  ).toBe(false);
  expect(shouldAutoSkipDirectConversation({ ...greeting, skillIds: ['report'] })).toBe(false);
  expect(shouldAutoSkipDirectConversation({ ...greeting, expertIds: ['reviewer'] })).toBe(false);
  expect(shouldAutoSkipDirectConversation({ ...greeting, attachmentCount: 1 })).toBe(false);
});

test('treats an omitted session mode as Work, matching the production entry policy', () => {
  expect(shouldAutoSkipDirectConversation({ prompt: 'Hello!' })).toBe(true);
});
