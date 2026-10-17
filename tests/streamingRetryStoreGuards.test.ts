/**
 * Store-backed guards for auto-retry stream reuse and non-retryable error turns.
 */
import './src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  adapter,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  createHarnessCoworkStore,
  ensureHarnessCoworkSession,
} from './helpers/harnessCoworkStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('streaming retry store guards', () => {
  setupPiRuntimeAdapterSuite();

  beforeEach(() => {
    adapter.on('error', () => {});
  });

  it('A9: non-retryable error then queued follow-up keeps prior assistant content in SQLite', async () => {
    let listener: ((event: unknown) => void) | null = null;
    mockSession.subscribe.mockImplementation((callback: (event: unknown) => void) => {
      listener = callback;
      return () => {};
    });
    const { store, cleanup } = await createHarnessCoworkStore();
    try {
      adapter.setCoworkStore(store);
      ensureHarnessCoworkSession(store, 'a9-session', 'work');
      await adapter.startSession('a9-session', 'First prompt', { sessionMode: 'work' });

      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Partial one' }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Partial one' },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Partial one' }],
          stopReason: 'error',
          errorMessage: '401 Unauthorized: invalid api key',
        },
      });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });

      const afterError = store.getSession('a9-session', null, { includeArtifacts: false })?.messages;
      const firstAssistant = afterError?.find(message => message.type === 'assistant');
      expect(firstAssistant?.content).toBe('Partial one');
      expect(firstAssistant?.metadata?.isStreaming).not.toBe(true);

      const continuation = adapter.continueSession('a9-session', 'Follow-up prompt', {
        sessionMode: 'work',
      });
      await Promise.resolve();
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Answer two' }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Answer two' },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer two' }],
          stopReason: 'stop',
        },
      });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await continuation;

      const messages =
        store.getSession('a9-session', null, { includeArtifacts: false })?.messages ?? [];
      const assistants = messages.filter(message => message.type === 'assistant');
      expect(assistants.length).toBeGreaterThanOrEqual(2);
      expect(assistants.some(message => message.content === 'Partial one')).toBe(true);
      expect(assistants.some(message => message.content === 'Answer two')).toBe(true);
      for (const message of messages) {
        expect(message.metadata?.isStreaming).not.toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it('arms stream reuse only after auto_retry_start, not on a terminal 401', async () => {
    let listener: ((event: unknown) => void) | null = null;
    mockSession.subscribe.mockImplementation((callback: (event: unknown) => void) => {
      listener = callback;
      return () => {};
    });
    const { store, cleanup } = await createHarnessCoworkStore();
    const updates: Array<{ messageId: string; content: string }> = [];
    adapter.on('messageUpdate', (_sid, messageId, content) => {
      updates.push({ messageId, content });
    });
    try {
      adapter.setCoworkStore(store);
      ensureHarnessCoworkSession(store, 'reuse-arm', 'chat');
      await adapter.startSession('reuse-arm', 'Hi');

      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Keep me' }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Keep me' },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Keep me' }],
          stopReason: 'error',
          errorMessage: '401 Unauthorized',
        },
      });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });

      expect(updates.some(update => update.content === '')).toBe(false);
      const assistant = store
        .getSession('reuse-arm', null, { includeArtifacts: false })
        ?.messages.find(message => message.type === 'assistant');
      expect(assistant?.content).toBe('Keep me');
    } finally {
      cleanup();
    }
  });
});
