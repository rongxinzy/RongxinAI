import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./TurnBlock.tsx', import.meta.url)), 'utf8');

test('keeps execution groups and nested thinking collapsed by default', () => {
  expect(source).toMatch(
    /<ChainOfThought\s+key=\{`\$\{groupKey\}-\$\{showCompletedSummary \? 'summarized' : 'working'\}`\}\s+defaultOpen=\{false\}/,
  );
  expect(source).toMatch(/<Reasoning[\s\S]*?defaultOpen=\{false\}/);
});

test('shows completed execution counts only after an answer follows the group', () => {
  expect(source).toContain('const flush = (followedByAnswer = false) => {');
  expect(source).toMatch(
    /const isAnswer =\s*item\.type === 'assistant' &&\s*!item\.message\.metadata\?\.isThinking &&\s*hasText\(item\.message\.content\);/,
  );
  expect(source).toContain('flush(true);');
  expect(source).toContain('const showCompletedSummary = group.followedByAnswer;');
});

test('keeps active tool details in the total summary without adding a child row', () => {
  expect(source).toContain('key="transient-working-summary"');
  expect(source).toContain('<ChainOfThoughtHeader icon={isActiveTool ? Wrench : SparklesIcon}>');
  expect(source).toContain('<ChainOfThoughtHeader icon={Wrench}>');
  expect(source).toContain('getExecutionStatusText(toolActivityStatus)');
  expect(source).toContain('toolActivityStatus && !finalAnswerItem && !hasTrailingExecutionGroup');
  expect(source).not.toContain('key={`tool-activity-${latestToolActivity.toolCallId}`}');
});
