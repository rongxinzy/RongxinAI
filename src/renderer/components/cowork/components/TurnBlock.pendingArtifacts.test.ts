// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import { TurnBlock } from './TurnBlock';

vi.mock('../../artifacts/ArtifactPreviewCard', () => ({
  default: ({ artifact, disabled }: { artifact: Artifact; disabled?: boolean }) =>
    React.createElement('button', { disabled, 'data-artifact-id': artifact.id }, artifact.title),
}));

test('keeps the same card node and footer layout while a persisted file becomes available', () => {
  const artifact: Artifact = {
    id: 'output',
    messageId: 'answer',
    sessionId: 'session',
    type: 'document',
    title: 'result.docx',
    content: '',
    source: CoworkArtifactSource.Tool,
    role: ArtifactRole.Deliverable,
    declared: true,
    createdAt: 1,
  };
  const turn = { id: 'turn', userMessage: null, assistantItems: [] };
  const view = render(React.createElement(TurnBlock, { turn, pendingArtifacts: [artifact] }));
  const card = view.getByRole('button', { name: artifact.title });
  const footer = card.parentElement;
  expect(card).toBeDisabled();
  view.rerender(
    React.createElement(TurnBlock, { turn, artifacts: [artifact], pendingArtifacts: [] }),
  );
  expect(view.getByRole('button', { name: artifact.title })).toBe(card);
  expect(card.parentElement).toBe(footer);
  expect(card).toBeEnabled();
});
