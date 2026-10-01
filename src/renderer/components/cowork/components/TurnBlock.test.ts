// @vitest-environment jsdom
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { CoworkErrorKind } from '../../../../common/coworkError';

import {
  CoworkMessageType,
  CoworkDisplayItemType,
  CoworkPermissionBehavior,
  CoworkPermissionOrigin,
} from '../../../../shared/cowork/constants';
import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import { i18nService } from '../../../services/i18n';
import type {
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
} from '../../../types/cowork';
import type { AssistantTurnItem, ConversationTurn } from '../helpers/messageGrouping';
import { TurnBlock, getTurnPrimaryExpert, isTerminalErrorItem } from './TurnBlock';
import { setPersistentToggleNamespace } from '../hooks/usePersistentToggle';

vi.mock('@shared/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
}));
i18nService.setLanguage('zh', { persist: false });
let counter = 0;
const message = (
  type: CoworkMessage['type'],
  content: string,
  metadata: CoworkMessageMetadata = {},
): CoworkMessage => ({ id: `message-${++counter}`, type, content, timestamp: counter, metadata });
const tool = (complete = true): AssistantTurnItem => {
  const toolUse = message(CoworkMessageType.ToolUse, '', {
    toolName: 'bash',
    toolInput: { command: 'pwd' },
  });
  return {
    type: CoworkDisplayItemType.ToolGroup,
    group: {
      type: CoworkDisplayItemType.ToolGroup,
      toolUse,
      toolResult: complete ? message(CoworkMessageType.ToolResult, 'ok') : undefined,
    },
  };
};
const answer = (content: string): AssistantTurnItem => ({
  type: CoworkMessageType.Assistant,
  message: message(CoworkMessageType.Assistant, content),
});
const renderTurn = (
  items: AssistantTurnItem[],
  props: Partial<Parameters<typeof TurnBlock>[0]> = {},
) => {
  setPersistentToggleNamespace(`test-${++counter}`);
  return render(
    createElement(TurnBlock, {
      turn: { id: `turn-${counter}`, userMessage: null, assistantItems: items },
      showCopyButtons: false,
      hideDefaultAssistantHeader: true,
      ...props,
    }),
  );
};

test('exposes tool entries directly without an outer execution toggle', () => {
  renderTurn([tool(), tool()]);
  const toggles = screen.getAllByRole('button');
  expect(toggles).toHaveLength(2);
  expect(toggles.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
  fireEvent.click(toggles[0]);
  expect(screen.getByText('ok')).toBeVisible();
  expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
});

test('preserves interim answers and terminal errors in stream order', () => {
  renderTurn([
    answer('先检查目录'),
    tool(),
    answer('检查完成'),
    {
      type: CoworkMessageType.System,
      message: message(CoworkMessageType.System, '连接失败', { error: 'connection failed' }),
    },
  ]);
  expect(screen.getByText('先检查目录')).toBeVisible();
  expect(screen.getByText('检查完成')).toBeVisible();
  expect(screen.getByText('连接失败')).toBeVisible();
});

test('shows matching permission immediately and forwards the original input', () => {
  const item = tool(false);
  if (item.type !== CoworkDisplayItemType.ToolGroup) throw new Error('Expected a tool fixture');
  const permission: CoworkPermissionRequest = {
    origin: CoworkPermissionOrigin.PiWorkbench,
    sessionId: 'session',
    requestId: 'request',
    toolName: 'bash',
    toolInput: { command: 'pwd' },
    toolUseId: item.group.toolUse.id,
  };
  const onRespondToPermission = vi.fn();
  renderTurn([item], {
    isTurnComplete: false,
    pendingPermission: permission,
    onRespondToPermission,
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkApprove') }));
  expect(onRespondToPermission).toHaveBeenCalledWith({
    behavior: CoworkPermissionBehavior.Allow,
    updatedInput: permission.toolInput,
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkDeny') }));
  expect(onRespondToPermission).toHaveBeenCalledWith({
    behavior: CoworkPermissionBehavior.Deny,
    message: 'Permission denied',
  });
});

test('keeps message-level states free of competing decorative animations', () => {
  const { container } = renderTurn([tool(false)], { isTurnComplete: false });
  expect(
    container.querySelector('.bg-clip-text, .animate-pulse, .animate-message-in, img'),
  ).toBeNull();
  expect(screen.getByText(i18nService.t('codingAgentToolRunning'))).toBeVisible();
});

test('keeps a preparation status visible without an empty collapsible', () => {
  renderTurn([], {
    isTurnComplete: false,
    toolActivities: [
      {
        toolCallId: 'preparing',
        toolName: 'bash',
        phase: CoworkToolActivityPhase.Preparing,
        updatedAt: 1,
      },
    ],
  });
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

test('only exposes resume for the recoverable task and honors disabled state', () => {
  const onResumeTask = vi.fn();
  const interruption = {
    sessionId: 'session',
    interruptionId: 'interruption',
    cause: CoworkInterruptionCause.RuntimePaused,
    taskId: 'task',
    recoverable: true,
  };
  const item: AssistantTurnItem = {
    type: CoworkMessageType.System,
    message: message(CoworkMessageType.System, '', { interruption }),
  };
  const { rerender } = renderTurn([item], {
    recoverableTaskId: 'task',
    onResumeTask,
    resumeDisabled: true,
  });
  expect(
    screen.getByRole('button', { name: i18nService.t('coworkResumeTaskAction') }),
  ).toBeDisabled();
  rerender(
    createElement(TurnBlock, {
      turn: { id: 'resumed', userMessage: null, assistantItems: [item] },
      recoverableTaskId: 'task',
      onResumeTask,
      showCopyButtons: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkResumeTaskAction') }));
  expect(onResumeTask).toHaveBeenCalledWith(interruption);
});

const expert = { expertId: 'expert-a', expertName: 'Draft Expert', presetId: 'draft' };

describe('getTurnPrimaryExpert', () => {
  test('prefers the frozen user-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: {
        id: 'user-1',
        type: CoworkMessageType.User,
        content: 'Write',
        timestamp: 1,
        metadata: { experts: [expert] },
      },
      assistantItems: [],
    };

    expect(getTurnPrimaryExpert(turn)).toEqual(expert);
  });

  test('falls back to the frozen assistant-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: null,
      assistantItems: [
        {
          type: CoworkMessageType.Assistant,
          message: {
            id: 'assistant-1',
            type: CoworkMessageType.Assistant,
            content: 'Done',
            timestamp: 2,
            metadata: { experts: [expert] },
          },
        },
      ],
    };

    expect(getTurnPrimaryExpert(turn)).toEqual(expert);
  });
});

describe('terminal error presentation', () => {
  test('identifies terminal system errors independently of their rendered content', () => {
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.System,
        message: {
          id: 'error-1',
          type: CoworkMessageType.System,
          content: '',
          timestamp: 1,
          metadata: { error: 'Model failed', errorKind: CoworkErrorKind.Unknown },
        },
      }),
    ).toBe(true);
  });

  test('keeps tool failures and approval interruptions out of terminal-error handling', () => {
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.ToolResult,
        message: {
          id: 'tool-1',
          type: CoworkMessageType.ToolResult,
          content: 'Command failed',
          timestamp: 1,
          metadata: { isError: true, error: 'Command failed' },
        },
      }),
    ).toBe(false);
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.System,
        message: {
          id: 'interruption-1',
          type: CoworkMessageType.System,
          content: '',
          timestamp: 2,
          metadata: {
            interruption: {
              cause: CoworkInterruptionCause.ApprovalDenied,
              sessionId: 'session-1',
              interruptionId: 'interruption-1',
              taskId: null,
              recoverable: false,
            },
          },
        },
      }),
    ).toBe(false);
  });
});
