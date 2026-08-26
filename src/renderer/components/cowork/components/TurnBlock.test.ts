import { describe, expect, test } from 'vitest';

import { CoworkErrorKind } from '../../../../common/coworkError';
import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { getTurnPrimaryExpert, isTerminalErrorItem } from './TurnBlock';

const expert = { expertId: 'expert-a', expertName: 'Draft Expert', presetId: 'draft' };

describe('getTurnPrimaryExpert', () => {
  test('prefers the frozen user-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: {
        id: 'user-1',
        type: 'user',
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
          type: 'assistant',
          message: {
            id: 'assistant-1',
            type: 'assistant',
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
        type: 'system',
        message: {
          id: 'error-1',
          type: 'system',
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
        type: 'tool_result',
        message: {
          id: 'tool-1',
          type: 'tool_result',
          content: 'Command failed',
          timestamp: 1,
          metadata: { isError: true, error: 'Command failed' },
        },
      }),
    ).toBe(false);
    expect(
      isTerminalErrorItem({
        type: 'system',
        message: {
          id: 'interruption-1',
          type: 'system',
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
