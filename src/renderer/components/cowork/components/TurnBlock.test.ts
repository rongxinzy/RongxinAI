import { describe, expect, test } from 'vitest';

import type { ConversationTurn } from '../helpers/messageGrouping';
import { getTurnPrimaryExpert } from './TurnBlock';

const expert = { expertId: 'expert-a', expertName: 'Draft Expert', presetId: 'draft' };

describe('getTurnPrimaryExpert', () => {
  test('prefers the frozen user-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: { id: 'user-1', type: 'user', content: 'Write', timestamp: 1, metadata: { experts: [expert] } },
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
          message: { id: 'assistant-1', type: 'assistant', content: 'Done', timestamp: 2, metadata: { experts: [expert] } },
        },
      ],
    };

    expect(getTurnPrimaryExpert(turn)).toEqual(expert);
  });
});
