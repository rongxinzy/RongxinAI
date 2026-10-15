// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { CoworkMessageType } from '../../../../shared/cowork/constants';
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

test('anchors a declaration outside the loaded page to its final answer immediately and only once', () => {
  const artifact: Artifact = {
    id: 'declared',
    messageId: 'old-declaration',
    sessionId: 'session',
    type: 'document',
    title: 'result.docx',
    content: '',
    filePath: 'D:/workspace/result.docx',
    source: CoworkArtifactSource.Tool,
    role: ArtifactRole.Deliverable,
    declared: true,
    createdAt: 1,
  };
  const declaration: ConversationTurn = {
    id: 'declaration-turn',
    userMessage: null,
    assistantItems: [
      {
        type: CoworkMessageType.Assistant,
        message: {
          id: 'old-declaration',
          type: CoworkMessageType.Assistant,
          content: 'Earlier output',
          timestamp: 1,
        },
      },
    ],
  };
  const answer: ConversationTurn = {
    id: 'answer-turn',
    userMessage: null,
    assistantItems: [
      {
        type: CoworkMessageType.Assistant,
        message: {
          id: 'answer',
          type: CoworkMessageType.Assistant,
          content: 'Delivered [result](file:///D:/workspace/result.docx)',
          timestamp: 2,
          metadata: { isFinalAnswer: true },
        },
      },
    ],
  };
  const view = renderHook(
    ({ turns }) => useTurnArtifacts(turns, [artifact], PREVIEWABLE_ARTIFACT_TYPES),
    { initialProps: { turns: [answer] } },
  );
  expect(view.result.current.get(answer.id)).toEqual([artifact]);
  view.rerender({ turns: [declaration, answer] });
  expect(view.result.current.get(answer.id)).toEqual([artifact]);
  expect(view.result.current.get(declaration.id)).toEqual([]);
});

test('reserves an inline workspace file reference without matching another directory', () => {
  const artifact: Artifact = {
    id: 'declared',
    messageId: 'outside-page',
    sessionId: 'session',
    type: 'document',
    title: 'result.docx',
    content: '',
    filePath: 'D:/workspace/result.docx',
    source: CoworkArtifactSource.Tool,
    role: ArtifactRole.Deliverable,
    declared: true,
    createdAt: 1,
  };
  const turn: ConversationTurn = {
    id: 'answer-turn',
    userMessage: null,
    assistantItems: [
      {
        type: CoworkMessageType.Assistant,
        message: {
          id: 'answer',
          type: CoworkMessageType.Assistant,
          timestamp: 2,
          content: 'Delivered **`result.docx`**',
          metadata: { isFinalAnswer: true },
        },
      },
    ],
  };
  const view = renderHook(
    ({ cwd }) => useTurnArtifacts([turn], [artifact], PREVIEWABLE_ARTIFACT_TYPES, cwd),
    { initialProps: { cwd: 'D:/workspace' } },
  );
  expect(view.result.current.get(turn.id)).toEqual([artifact]);
  view.rerender({ cwd: 'D:/other' });
  expect(view.result.current.get(turn.id)).toEqual([]);
});
