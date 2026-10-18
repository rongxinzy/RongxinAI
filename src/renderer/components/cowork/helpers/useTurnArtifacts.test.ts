// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import type { CoworkMessage } from '../../../types/cowork';
import type { ConversationTurn } from './messageGrouping';
import { useTurnArtifacts } from './useTurnArtifacts';

const toolUseMetadata = {
  toolUseId: 'toolu-abc',
  toolName: 'write',
  status: 'completed',
  approvalStatus: 'approved',
};

const assistantMessage = (id: string, content = 'answer'): CoworkMessage => ({
  id,
  type: 'assistant',
  content,
  timestamp: 1,
});

const toolGroupTurn = (id: string): ConversationTurn =>
  ({
    id,
    timestamp: 1,
    assistantItems: [
      {
        type: 'tool_group',
        group: {
          id: 'group-1',
          status: 'completed',
          toolUse: {
            id: 'toolu-msg',
            type: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu-abc', name: 'write', input: {} }],
            timestamp: 1,
            metadata: toolUseMetadata,
          },
          toolResult: { id: 'toolr-msg', type: 'tool_result', content: [], timestamp: 1 },
        },
      },
      { type: 'assistant', message: assistantMessage('final-msg', 'wrote the file') },
    ],
  }) as unknown as ConversationTurn;

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'row-1',
  messageId: 'toolr-msg',
  sessionId: 'session-1',
  type: 'html',
  title: 'Row',
  content: '<h1>hi</h1>',
  source: CoworkArtifactSource.Tool,
  role: ArtifactRole.Intermediate,
  declared: false,
  toolCallId: 'toolu-abc',
  createdAt: 1,
  ...overrides,
});

const previewable = new Set(['html', 'svg']);

const renderTurnArtifacts = (props: {
  turns: ConversationTurn[];
  artifacts: Artifact[];
  previewable?: ReadonlySet<string>;
}) =>
  renderHook(
    (next: typeof props) =>
      useTurnArtifacts(next.turns, next.artifacts, next.previewable ?? previewable),
    { initialProps: props },
  );

test('anchors a ledger row on its toolCallId inside the producing tool_group', () => {
  const map = renderTurnArtifacts({
    turns: [toolGroupTurn('turn-1')],
    artifacts: [artifact()],
  }).result.current;
  expect(map.get('turn-1')?.map(row => row.id)).toEqual(['row-1']);
});

test('anchors a ledger row on its messageId when the toolCallId is absent', () => {
  const toolResultRow = artifact({ toolCallId: undefined, messageId: 'toolr-msg' });
  const map = renderTurnArtifacts({
    turns: [toolGroupTurn('turn-1')],
    artifacts: [toolResultRow],
  }).result.current;
  expect(map.get('turn-1')?.map(row => row.id)).toEqual(['row-1']);
});

test('anchors a declared deliverable on the final answer message id', () => {
  const finalRow = artifact({
    id: 'row-final',
    messageId: 'final-msg',
    toolCallId: null,
    declared: true,
    role: ArtifactRole.Deliverable,
  });
  const map = renderTurnArtifacts({
    turns: [toolGroupTurn('turn-1')],
    artifacts: [finalRow],
  }).result.current;
  expect(map.get('turn-1')?.map(row => row.id)).toEqual(['row-final']);
});

test('ignores rows anchored outside the loaded turns', () => {
  const otherToolRow = artifact({ id: 'row-other', toolCallId: 'toolu-zzz', messageId: 'nope' });
  const map = renderTurnArtifacts({
    turns: [toolGroupTurn('turn-1')],
    artifacts: [otherToolRow],
  }).result.current;
  expect(map.get('turn-1')).toEqual([]);
});

test('filters by previewable types but not by declared flag', () => {
  const binaryRow = artifact({ id: 'row-bin', type: 'document' });
  const undeclaredRow = artifact({ id: 'row-plain', declared: false });
  const map = renderTurnArtifacts({
    turns: [toolGroupTurn('turn-1')],
    artifacts: [binaryRow, undeclaredRow],
  }).result.current;
  expect(map.get('turn-1')?.map(row => row.id)).toEqual(['row-plain']);
});

test('keeps array identity across re-renders with unchanged artifact references', () => {
  const rows = [artifact()];
  const view = renderTurnArtifacts({ turns: [toolGroupTurn('turn-1')], artifacts: rows });
  const first = view.result.current.get('turn-1');
  view.rerender({ turns: [toolGroupTurn('turn-1')], artifacts: rows });
  const second = view.result.current.get('turn-1');
  expect(second).toBe(first);
});
