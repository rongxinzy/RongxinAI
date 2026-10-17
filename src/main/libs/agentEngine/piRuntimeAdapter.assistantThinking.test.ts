/**
 * PiRuntimeAdapter unit tests: assistant streaming event mapping (thinking
 * messages and turn-edge cases).
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import { adapter, mockSession, setupPiRuntimeAdapterSuite } from './piRuntimeAdapter.testHarness';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoworkStore } from '../../coworkStore';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('assistant streaming event mapping', () => {
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    afterEach(() => {
      // Only the usage-persistence test stubs a context snapshot; reset it so no
      // sibling test starts persisting contextUsage it did not ask for.
      mockSession.getContextUsage.mockReset();
    });

    it('closes a whitespace-only placeholder when the turn ends without an answer', async () => {
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );
      const stored: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      const updateMessage = vi.fn(
        (_sessionId: string, messageId: string, patch: { metadata?: Record<string, unknown> }) => {
          const target = stored.find(message => message.id === messageId);
          if (target && patch.metadata) target.metadata = { ...target.metadata, ...patch.metadata };
        },
      );
      adapter.setCoworkStore({
        addMessage: (_sessionId: string, message: Record<string, unknown>) => {
          const created = { ...message, id: `placeholder-${stored.length + 1}` };
          stored.push(created as never);
          return created;
        },
        getSession: () => ({ messages: stored }),
        updateMessage,
      } as unknown as CoworkStore);

      await adapter.startSession('test', 'Use a tool without writing an answer');
      listener!({ type: 'turn_start' });
      // Models routinely emit bare newlines before a tool call: the bubble is
      // created with isStreaming and must not survive the turn.
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '\n\n' },
        message: { role: 'assistant', content: [{ type: 'text', text: '\n\n' }] },
      });
      const placeholder = messages.find(message => message.type === 'assistant');
      expect(placeholder?.metadata?.isStreaming).toBe(true);

      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '\n\n' }],
          stopReason: 'toolUse',
        },
      });

      expect(
        updates.some(
          update =>
            update.messageId === placeholder?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
      expect(updateMessage).toHaveBeenCalledWith(
        'test',
        placeholder?.id,
        expect.objectContaining({
          metadata: expect.objectContaining({ isStreaming: false, isFinal: true }),
        }),
      );
      // The persisted row is what any later session load reads.
      const persisted = stored.find(message => message.id === placeholder?.id);
      expect(persisted?.metadata).toMatchObject({ isStreaming: false, isFinal: true });
    });

    it('should stream the answer when text starts without a thinking_end event', async () => {
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Think before answering');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting context' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting context' }],
        },
      });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Still inspecting' },
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Inspecting context further' },
            { type: 'text', text: 'Visible answer' },
          ],
        },
      });

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      const answerMessage = messages.find(
        message => message.type === 'assistant' && message.metadata?.isThinking !== true,
      );
      expect(answerMessage).toMatchObject({
        content: 'Visible answer',
        metadata: { isStreaming: true, isFinal: false },
      });
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should not turn a thinking-only message into an answer', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));

      await adapter.startSession('test', 'Think before using a tool');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I need to inspect the files first.' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I need to inspect the files first.' }],
          stopReason: 'stop',
        },
      });

      const assistantMessages = messages.filter(message => message.type === 'assistant');
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].metadata?.isThinking).toBe(true);
    });

    it('should finalize active thinking when the user stops the turn', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, message) => messages.push(message as never));
      adapter.on('messageUpdate', (_sid, messageId, _content, metadata) =>
        updates.push({ messageId, metadata }),
      );

      await adapter.startSession('test', 'Stop after thinking');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting' }],
        },
      });

      adapter.stopSession('test');

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should finalize active thinking when the assistant ends with an error', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, message) => messages.push(message as never));
      adapter.on('messageUpdate', (_sid, messageId, _content, metadata) =>
        updates.push({ messageId, metadata }),
      );
      adapter.on('error', () => undefined);

      await adapter.startSession('test', 'Fail after thinking');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Inspecting before failure' }],
          stopReason: 'error',
          errorMessage: 'Model failed',
        },
      });

      const thinkingMessage = messages.find(message => message.metadata?.isThinking === true);
      expect(
        updates.some(
          update =>
            update.messageId === thinkingMessage?.id &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
    });

    it('should not lose intermediate updates during a fast stream (no burst-freeze)', async () => {
      vi.useFakeTimers();
      try {
        const updates: string[] = [];
        adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
        await adapter.startSession('test', 'Hi');

        listener!({ type: 'turn_start' });
        // Rapid snapshots 50ms apart (faster than the 200ms throttle window).
        const snaps = ['a', 'ab', 'abc', 'abcd', 'abcde'];
        for (const s of snaps) {
          listener!({
            type: 'message_update',
            message: { role: 'assistant', content: [{ type: 'text', text: s }] },
          });
          vi.advanceTimersByTime(50);
        }
        // Let any trailing throttle timer fire.
        vi.advanceTimersByTime(250);

        // Leading emit fires immediately; a trailing emit must deliver the latest
        // content — the timer must NOT be perpetually re-armed (which would freeze
        // the UI until the stream paused).
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates[updates.length - 1]).toBe('abcde');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
