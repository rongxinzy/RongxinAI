// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { i18nService } from '../../../services/i18n';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { TurnBlock } from './TurnBlock';

test('preserves the companion DOM from waiting through streaming and completion', () => {
  const turn: ConversationTurn = { id: 'stable-turn', userMessage: null, assistantItems: [] };
  const view = render(
    createElement(TurnBlock, {
      turn,
      isTurnComplete: false,
      showTypingIndicator: true,
      showCopyButtons: false,
    }),
  );
  const companion = view.getByRole('img', { name: i18nService.t('agentCompanionThinkingLabel') });
  const images = Array.from(companion.querySelectorAll('img'));
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
  expect(view.getByRole('img', { name: i18nService.t('agentCompanionThinkingLabel') })).toBe(
    companion,
  );
  expect(Array.from(companion.querySelectorAll('img'))).toEqual(images);
  expect(view.queryByRole('status')).toBeNull();
  view.rerender(
    createElement(TurnBlock, {
      turn: streamingTurn,
      isTurnComplete: true,
      showCopyButtons: false,
    }),
  );
  expect(view.getByRole('img', { name: i18nService.t('agentCompanionCompletedLabel') })).toBe(
    companion,
  );
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
