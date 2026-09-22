import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import type { AssistantTurnItem } from '../helpers/messageGrouping';
import { i18nService } from '../../../services/i18n';
import { TurnBlock } from './TurnBlock';
import { createDirectChatErrorMessage } from '../../../services/coworkTerminalError';

test('a persisted direct chat failure stays visible without a working summary', () => {
  const message = JSON.parse(
    JSON.stringify(createDirectChatErrorMessage(new Error('503 unavailable'))),
  ) as ReturnType<typeof createDirectChatErrorMessage>;
  const html = renderToStaticMarkup(
    React.createElement(TurnBlock, {
      turn: {
        id: 'failed-chat',
        userMessage: null,
        assistantItems: [{ type: 'system', message }],
      },
      showCopyButtons: false,
      isTurnComplete: true,
    }),
  );
  expect(html).toContain(i18nService.t('coworkErrorServerError'));
  expect(html).not.toContain(i18nService.t('coworkIntermediateProcess'));
});

const stop: AssistantTurnItem = {
  type: 'system',
  message: {
    id: 'stop',
    type: 'system',
    content: '',
    timestamp: 2,
    metadata: {
      interruption: {
        cause: CoworkInterruptionCause.UserStop,
        taskId: 'task',
        sessionId: 'session',
        interruptionId: 'interruption',
        recoverable: false,
      },
    },
  },
};
const answer: AssistantTurnItem = {
  type: 'assistant',
  message: {
    id: 'final',
    type: 'assistant',
    content: 'NEW_FINAL_RESPONSE',
    timestamp: 3,
    metadata: { isFinalAnswer: true, isFinal: true },
  },
};

test('a historical stop remains above the resumed final answer', () => {
  const html = renderToStaticMarkup(
    React.createElement(TurnBlock, {
      turn: { id: 'turn', userMessage: null, assistantItems: [stop, answer] },
      showCopyButtons: false,
    }),
  );
  expect(html.indexOf(i18nService.t('coworkInterruptionUserStop'))).toBeGreaterThan(-1);
  expect(html.indexOf(i18nService.t('coworkInterruptionUserStop'))).toBeLessThan(
    html.indexOf('NEW_FINAL_RESPONSE'),
  );
});
test('a stop after a final answer stays below that answer', () => {
  const html = renderToStaticMarkup(
    React.createElement(TurnBlock, {
      turn: { id: 'turn', userMessage: null, assistantItems: [answer, stop] },
      showCopyButtons: false,
    }),
  );
  expect(html.indexOf(i18nService.t('coworkInterruptionUserStop'))).toBeGreaterThan(
    html.indexOf('NEW_FINAL_RESPONSE'),
  );
});
