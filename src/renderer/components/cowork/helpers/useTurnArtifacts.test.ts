// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { ArtifactRole, PREVIEWABLE_ARTIFACT_TYPES, type Artifact } from '../../../types/artifact';
import type { ConversationTurn } from './messageGrouping';
import { useTurnArtifacts } from './useTurnArtifacts';

test('maps a persisted deliverable to its final answer anchor in the loaded message page', () => {
  const turn: ConversationTurn = {
    id: 'user-message',
    userMessage: null,
    assistantItems: [
      {
        type: 'assistant',
        message: {
          id: 'final-answer-in-current-page',
          type: 'assistant',
          content: 'Delivered D:/workspace/presentation.pptx',
          timestamp: 2,
          metadata: { isFinal: true, isFinalAnswer: true },
        },
      },
    ],
  };
  const artifact: Artifact = {
    id: 'declared-artifact',
    messageId: 'final-answer-in-current-page',
    sessionId: 'session-1',
    type: 'document',
    title: 'presentation.pptx',
    content: '',
    fileName: 'presentation.pptx',
    filePath: 'D:/workspace/presentation.pptx',
    source: 'tool',
    role: ArtifactRole.Deliverable,
    declared: true,
    createdAt: 1,
  };

  const view = renderHook(() => useTurnArtifacts([turn], [artifact], PREVIEWABLE_ARTIFACT_TYPES));

  expect(view.result.current.get('user-message')).toEqual([artifact]);
});
