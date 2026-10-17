import { expect, test } from 'vitest';

import { CodingEventKind, CodingStreamUpdateMode } from '../../../shared/codingAgent';
import { AcpSessionUpdateNormalizer } from './acpDriverUpdates';

test('normalizes message chunks with an explicit message id and role', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  expect(
    normalizer.normalizeUpdate('session-1', {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'message-1',
      content: 'Implemented.',
    }),
  ).toEqual([
    {
      kind: CodingEventKind.MessageDelta,
      payload: {
        content: 'Implemented.',
        messageId: 'message-1',
        role: 'assistant',
        streamUpdateMode: CodingStreamUpdateMode.Append,
      },
    },
  ]);
  expect(
    normalizer.normalizeUpdate('session-1', {
      sessionUpdate: 'user_message_chunk',
      messageId: 'message-2',
      content: 'Run the build.',
    }),
  ).toEqual([
    {
      kind: CodingEventKind.MessageDelta,
      payload: {
        content: 'Run the build.',
        messageId: 'message-2',
        role: 'user',
        streamUpdateMode: CodingStreamUpdateMode.Append,
      },
    },
  ]);
});

test('reuses stable fallback message ids per session and role', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  const first = normalizer.normalizeUpdate('session-1', {
    sessionUpdate: 'agent_message_chunk',
    content: 'First.',
  });
  const second = normalizer.normalizeUpdate('session-1', {
    sessionUpdate: 'agent_message_chunk',
    content: 'Second.',
  });
  const user = normalizer.normalizeUpdate('session-1', {
    sessionUpdate: 'user_message_chunk',
    content: 'Prompt.',
  });
  const otherSession = normalizer.normalizeUpdate('session-2', {
    sessionUpdate: 'agent_message_chunk',
    content: 'Elsewhere.',
  });
  expect(first[0].payload.messageId).toBe(second[0].payload.messageId);
  expect(first[0].payload.messageId).not.toBe(user[0].payload.messageId);
  expect(first[0].payload.messageId).not.toBe(otherSession[0].payload.messageId);

  normalizer.forgetMessageFallbacks('session-1');
  const afterForget = normalizer.normalizeUpdate('session-1', {
    sessionUpdate: 'agent_message_chunk',
    content: 'Fresh turn.',
  });
  expect(afterForget[0].payload.messageId).not.toBe(first[0].payload.messageId);
});

test('flattens mixed content blocks into markdown message content', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  const [event] = normalizer.normalizeUpdate('session-1', {
    sessionUpdate: 'agent_message_chunk',
    content: [
      { type: 'text', text: 'First part.' },
      { type: 'text', text: ' second part.' },
      { type: 'resource_link', name: 'spec.md', title: 'Spec', uri: 'file:///workspace/spec.md' },
      { type: 'image', uri: 'file:///workspace/shot.png' },
      { type: 'audio', uri: 'file:///workspace/clip.mp3', mimeType: 'audio/mpeg' },
      {
        type: 'resource',
        resource: { uri: 'file:///workspace/notes.txt', text: 'embedded notes' },
      },
      { type: 'unknown' },
    ],
  });
  expect(event.kind).toBe(CodingEventKind.MessageDelta);
  expect(event.payload.content).toBe(
    'First part. second part.\n\n[Spec](file:///workspace/spec.md)\n\n![file:///workspace/shot.png](file:///workspace/shot.png)\n\n[audio (audio/mpeg)](file:///workspace/clip.mp3)\n\nembedded notes',
  );
});

test('drops updates whose content cannot be rendered', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  expect(
    normalizer.normalizeUpdate('session-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'unknown' },
    }),
  ).toEqual([]);
  expect(normalizer.normalizeUpdate('session-1', { sessionUpdate: 'agent_thought_chunk' })).toEqual(
    [],
  );
});

test('normalizes thought chunks into reasoning events', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  expect(
    normalizer.normalizeUpdate('session-1', {
      sessionUpdate: 'agent_thought_chunk',
      content: [{ type: 'text', text: 'Checking edge cases.' }],
    }),
  ).toEqual([{ kind: CodingEventKind.Reasoning, payload: { content: 'Checking edge cases.' } }]);
});

test('normalizes plan updates by passing the payload through', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  for (const sessionUpdate of ['plan', 'plan_update', 'plan_removed']) {
    expect(
      normalizer.normalizeUpdate('session-1', { sessionUpdate, entries: [{ step: 1 }] }),
    ).toEqual([{ kind: CodingEventKind.Plan, payload: { sessionUpdate, entries: [{ step: 1 }] } }]);
  }
});

test('normalizes tool call updates and their diff and terminal content', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  expect(
    normalizer.normalizeUpdate('session-1', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      content: [
        { type: 'diff', path: 'src/main.ts' },
        { type: 'terminal', terminalId: 'terminal-1' },
        { type: 'text', text: 'ignored' },
      ],
    }),
  ).toEqual([
    {
      kind: CodingEventKind.ToolCall,
      payload: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        content: [
          { type: 'diff', path: 'src/main.ts' },
          { type: 'terminal', terminalId: 'terminal-1' },
          { type: 'text', text: 'ignored' },
        ],
      },
    },
    { kind: CodingEventKind.FileChange, payload: { type: 'diff', path: 'src/main.ts' } },
    { kind: CodingEventKind.Terminal, payload: { type: 'terminal', terminalId: 'terminal-1' } },
  ]);
});

test('normalizes usage updates and bare string content', () => {
  const normalizer = new AcpSessionUpdateNormalizer();
  expect(
    normalizer.normalizeUpdate('session-1', { sessionUpdate: 'usage_update', input: 5 }),
  ).toEqual([
    { kind: CodingEventKind.Usage, payload: { sessionUpdate: 'usage_update', input: 5 } },
  ]);
  expect(
    normalizer.normalizeUpdate('session-1', { sessionUpdate: 'unknown', content: 'plain' }),
  ).toEqual([{ kind: CodingEventKind.Message, payload: { content: 'plain' } }]);
  expect(normalizer.normalizeUpdate('session-1', { sessionUpdate: 'unknown' })).toEqual([]);
});
