// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  CoworkToolActivityPhase,
  type CoworkToolActivity,
} from '../../../../shared/cowork/toolActivity';
import { i18nService } from '../../../services/i18n';
import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import type { AssistantTurnItem } from '../helpers/messageGrouping';
import { TurnBlock } from './TurnBlock';

i18nService.setLanguage('zh', { persist: false });

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${(counter += 1)}`;

const message = (
  type: CoworkMessage['type'],
  content: string,
  metadata: CoworkMessageMetadata = {},
): CoworkMessage => ({
  id: nextId(type),
  type,
  content,
  timestamp: counter,
  metadata,
});

const thinking = (streaming: boolean): AssistantTurnItem => ({
  type: 'assistant',
  message: message('assistant', '分析中', { isThinking: true, isStreaming: streaming }),
});

const settledTool = (): AssistantTurnItem => {
  const toolUseId = nextId('toolUse');
  return {
    type: 'tool_group',
    group: {
      type: 'tool_group',
      toolUse: message('tool_use', '', { toolName: 'bash', toolUseId }),
      toolResult: message('tool_result', 'ok', { toolUseId }),
    },
  };
};

const answer = (content: string): AssistantTurnItem => ({
  type: 'assistant',
  message: message('assistant', content),
});

const toolActivity = (): CoworkToolActivity => ({
  toolCallId: nextId('activity'),
  phase: CoworkToolActivityPhase.Preparing,
  toolName: 'bash',
  updatedAt: counter,
});

/** Shimmer paints its label with a background-clip gradient. */
const shimmerLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.bg-clip-text')].map(node => node.textContent ?? '');

const summaryPrefix = i18nService.t('coworkExecutionCompletedSummary').split('{')[0].trim();

const renderTurn = (
  assistantItems: AssistantTurnItem[],
  props: { isTurnComplete?: boolean; toolActivities?: CoworkToolActivity[] } = {},
) =>
  render(
    <TurnBlock
      turn={{
        id: nextId('turn'),
        // Live status rows only shimmer for expert turns in this repository, so
        // the fixtures declare one.
        userMessage: message('user', '', {
          experts: [{ expertId: 'expert', expertName: 'General', presetId: 'general' }],
        }),
        assistantItems,
      }}
      isTurnComplete={props.isTurnComplete ?? false}
      toolActivities={props.toolActivities}
      showCopyButtons={false}
    />,
  );

// Review finding: an interim answer ends the group list, and the earlier
// execution summary is the only row left that can show activity.
test('keeps the shimmer on the execution summary when an interim answer follows', () => {
  const { container } = renderTurn([thinking(false), settledTool(), answer('继续检查')]);

  expect(shimmerLabels(container)).toHaveLength(1);
  expect(shimmerLabels(container)[0]).toContain(summaryPrefix);
});

// Review finding: a preparing tool disables the bottom indicator through
// hasTrailingExecutionGroup, so deferring to it left the screen with none.
test('shimmers the summary when the bottom tool indicator is suppressed', () => {
  const { container } = renderTurn([settledTool()], { toolActivities: [toolActivity()] });

  expect(shimmerLabels(container)).toHaveLength(1);
  expect(shimmerLabels(container)[0]).toContain(summaryPrefix);
});

// Review finding: expanding the summary revealed a second cyclic animation
// (the streaming "thinking" trigger inside it).
test('yields the shimmer to the inner thinking indicator while the summary is expanded', () => {
  const { container } = renderTurn([thinking(true), settledTool()]);

  expect(shimmerLabels(container)).toHaveLength(1);
  expect(shimmerLabels(container)[0]).toContain(summaryPrefix);

  fireEvent.click(screen.getByRole('button', { name: new RegExp(summaryPrefix) }));

  expect(shimmerLabels(container)).toHaveLength(1);
  expect(shimmerLabels(container)[0]).toContain('思考中');
});

test('stops the summary shimmer once the turn is complete', () => {
  const { container } = renderTurn([thinking(false), settledTool()], { isTurnComplete: true });

  expect(shimmerLabels(container)).toHaveLength(0);
});

test('leaves the summary static while the trailing tool indicator animates', () => {
  const { container } = renderTurn([settledTool(), answer('先看目录')], {
    toolActivities: [toolActivity()],
  });

  // The trailing answer group renders no header, so the bottom indicator owns
  // the single cyclic animation.
  expect(shimmerLabels(container)).toHaveLength(1);
  expect(shimmerLabels(container)[0]).not.toContain(summaryPrefix);
});
