import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./TurnBlock.tsx', import.meta.url)), 'utf8');

test('keeps execution groups and nested thinking collapsed by default', () => {
  expect(source).toMatch(
    /<PersistentChainOfThought\s+key=\{`\$\{groupKey\}-\$\{showCompletedSummary \? 'summarized' : 'working'\}`\}\s+persistKey=\{`cot-\$\{turn\.id\}-\$\{groupKey\}`\}\s+defaultOpen=\{false\}/,
  );
  expect(source).toMatch(/<PersistentReasoning[\s\S]*?defaultOpen=\{false\}/);
});

test('settles execution counts after an answer or when the turn reaches a terminal state', () => {
  expect(source).toContain('const flush = (followedByAnswer = false) => {');
  expect(source).toMatch(
    /const isAnswer =\s*item\.type === 'assistant' &&\s*!item\.message\.metadata\?\.isThinking &&\s*hasText\(item\.message\.content\);/,
  );
  expect(source).toContain('flush(isAnswer);');
  expect(source).toContain(
    'const showCompletedSummary = group.followedByAnswer || isTurnComplete;',
  );
});

test('keeps recoverable interruptions outside reasoning and exposes a message action', () => {
  expect(source).toContain('Boolean(item.message.metadata?.interruption)');
  expect(source).toContain('interruption.taskId === recoverableTaskId');
  expect(source).toContain('<MessageAction');
  expect(source).toContain("i18nService.t('coworkResumeTaskAction')");
  expect(source).toContain('onClick={() => onResumeTask(interruption)}');
});

test('keeps terminal errors visible outside execution summaries', () => {
  expect(source).toContain('const isStandaloneSystem = isStandaloneSystemItem(item);');
  expect(source).toContain('if (isAnswer || isStandaloneSystem)');
  expect(source).toContain(
    '(item, index) => index !== finalAnswerIndex && !isStandaloneSystemItem(item)',
  );
  expect(source).toContain(
    '{standaloneSystemItems.map((item, index) => renderItem(item, index, false))}',
  );
});

test('renders the working indicator instead of the retired typing dots', () => {
  expect(source).toContain('{showTypingIndicator && <WorkingIndicator />}');
  expect(source).toContain("import { WorkingIndicator } from './WorkingIndicator';");
  expect(source).not.toContain('TypingDots');
});

test('keeps active tool details in the total summary without adding a child row', () => {
  expect(source).toContain('key="transient-working-summary"');
  expect(source).toContain('<ChainOfThoughtHeader icon={isActiveTool ? Wrench : SparklesIcon}>');
  expect(source).toContain('<ChainOfThoughtHeader icon={Wrench}>');
  expect(source).toContain('getExecutionStatusText(toolActivityStatus)');
  expect(source).toContain('toolActivityStatus && !finalAnswerItem && !hasTrailingExecutionGroup');
  expect(source).not.toContain('key={`tool-activity-${latestToolActivity.toolCallId}`}');
});
