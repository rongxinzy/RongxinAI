// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { CoworkMessageType } from '../../../../shared/cowork/constants';
import type { CoworkMessage } from '../../../types/cowork';
import { useInlineArtifacts } from './useInlineArtifacts';

const dispatch = vi.fn();

vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));

const assistantMessage = (
  id: string,
  content: string,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage => ({
  id,
  type: CoworkMessageType.Assistant,
  content,
  timestamp: 1,
  metadata,
});

const dispatchedPayloads = () => dispatch.mock.calls.map(call => call[0].payload);

beforeEach(() => {
  dispatch.mockClear();
});

const renderInlineArtifacts = (props: {
  sessionId?: string;
  messages?: CoworkMessage[];
  isStreaming?: boolean;
}) =>
  renderHook(
    (next: typeof props) =>
      useInlineArtifacts({
        sessionId: next.sessionId,
        messages: next.messages,
        isStreaming: next.isStreaming ?? false,
      }),
    { initialProps: props },
  );

test('projects inline artifacts of settled assistant messages in first paint', () => {
  renderInlineArtifacts({
    sessionId: 'session-1',
    messages: [
      assistantMessage('m-1', '```html\n<h1>a</h1>\n```'),
      assistantMessage('m-2', 'no blocks here'),
    ],
  });

  const payloads = dispatchedPayloads();
  expect(payloads).toEqual([
    {
      sessionId: 'session-1',
      artifact: expect.objectContaining({
        id: 'artifact-m-1-0',
        messageId: 'm-1',
        sessionId: 'session-1',
        type: 'html',
        source: 'codeblock',
      }),
    },
  ]);
});

test('skips projection while the session is streaming', () => {
  const view = renderInlineArtifacts({
    sessionId: 'session-1',
    messages: [assistantMessage('m-1', '```html\n<h1>a</h1>\n```', { isStreaming: true })],
    isStreaming: true,
  });
  expect(dispatch).not.toHaveBeenCalled();

  // The transcript settling re-runs the projection and covers the message.
  view.rerender({
    sessionId: 'session-1',
    messages: [assistantMessage('m-1', '```html\n<h1>a</h1>\n```')],
    isStreaming: false,
  });
  expect(dispatchedPayloads().map(payload => payload.artifact.id)).toEqual(['artifact-m-1-0']);
});

test('does nothing without a session or messages', () => {
  renderInlineArtifacts({ sessionId: undefined, messages: undefined });
  renderInlineArtifacts({ sessionId: 'session-1', messages: [] });
  expect(dispatch).not.toHaveBeenCalled();
});
