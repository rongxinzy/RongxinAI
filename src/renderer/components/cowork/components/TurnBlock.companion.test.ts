// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { i18nService } from '../../../services/i18n';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { TurnBlock } from './TurnBlock';

test('uses a static waiting status through streaming and completion', () => {
  const turn: ConversationTurn = { id: 'stable-turn', userMessage: null, assistantItems: [] };
  const view = render(
    createElement(TurnBlock, {
      turn,
      isTurnComplete: false,
      showTypingIndicator: true,
      showCopyButtons: false,
    }),
  );
  expect(view.queryByRole('img')).toBeNull();
  expect(view.getByRole('status')).toHaveTextContent(i18nService.t('coworkWorkingThinking'));
  const streamingTurn: ConversationTurn = {
    ...turn,
    assistantItems: [
      {
        type: 'assistant',
        message: {
          id: 'response',
          type: 'assistant',
          content: 'Streaming answer',
          timestamp: 1,
        },
      },
    ],
  };
  view.rerender(
    createElement(TurnBlock, {
      turn: streamingTurn,
      isTurnComplete: false,
      showTypingIndicator: false,
      showCopyButtons: false,
    }),
  );
  expect(view.queryByRole('img')).toBeNull();
  expect(view.getByText('Streaming answer')).toBeVisible();
  expect(view.queryByRole('status')).toBeNull();
  view.rerender(
    createElement(TurnBlock, {
      turn: streamingTurn,
      isTurnComplete: true,
      showCopyButtons: false,
    }),
  );
  expect(view.queryByRole('img')).toBeNull();
  expect(view.queryByRole('status')).toBeNull();
});

test('keeps the companion absent when the default header is hidden', () => {
  const view = render(
    createElement(TurnBlock, {
      turn: { id: 'hidden-header', userMessage: null, assistantItems: [] },
      hideDefaultAssistantHeader: true,
      isTurnComplete: false,
      showTypingIndicator: true,
    }),
  );
  expect(view.queryByRole('img')).toBeNull();
  expect(view.getByRole('status')).toBeTruthy();
});
