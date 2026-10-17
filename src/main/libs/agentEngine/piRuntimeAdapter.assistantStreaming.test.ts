/**
 * PiRuntimeAdapter unit tests: assistant streaming event mapping (answer
 * lifecycle, usage persistence, loop answers).
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  mockCreateAgentSession,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAgentLoopAction, PiAgentLoopMode, PiAgentLoopToolName } from './piAgentLoop';
import type { CoworkStore } from '../../coworkStore';
import {
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
} from './piWriteTokenLimit';

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

    /**
     * Drive a full assistant turn. message_update carries the FULL accumulating
     * snapshot (blocks of {type:'text',text}), matching real Pi behavior.
     */
    const driveAssistantTurn = (text: string) => {
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
    };

    it('should emit exactly ONE assistant message event per turn (no duplicate bubble)', async () => {
      const assistantMessages: Array<{ id: string; type: string }> = [];
      const updates: Array<{ messageId: string; content: string }> = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') assistantMessages.push(msg as never);
      });
      adapter.on('messageUpdate', (_sid, messageId, content) =>
        updates.push({ messageId, content }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Hello world');

      // Exactly one 'message' event (the streaming seed), finalized via messageUpdate —
      // NOT a second 'message' event, which is what caused duplicate rendering.
      expect(assistantMessages).toHaveLength(1);
      // The final content is delivered on the same message id.
      const finalUpdate = updates[updates.length - 1];
      expect(finalUpdate.messageId).toBe(assistantMessages[0].id);
      expect(finalUpdate.content).toBe('Hello world');
    });

    it('records Pi startup latency from AgentSession creation to first token', async () => {
      const logSpy = vi.spyOn(console, 'log');
      await adapter.startSession('startup-latency', 'Hi');

      listener!({ type: 'agent_start' });
      listener!({ type: 'turn_start' });
      listener!({ type: 'message_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[PiRuntime\] startup latency for startup-latency: create-to-agent_start=\d+ms, agent_start-to-first_token=\d+ms, create-to-first_token=\d+ms/,
        ),
      );
      logSpy.mockRestore();
    });

    it('should keep the same message id across stream and finalize', async () => {
      const ids = new Set<string>();
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') ids.add((msg as { id: string }).id);
      });
      adapter.on('messageUpdate', (_sid, messageId) => ids.add(messageId));

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('One two three');

      // Streaming updates and the seeded message must all share a single id.
      expect(ids.size).toBe(1);
    });

    it('should SET content from snapshots, never append (no repeated content)', async () => {
      const updates: string[] = [];
      adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
      await adapter.startSession('test', 'Hi');

      // Three accumulating snapshots (as Pi sends them), not deltas.
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hel' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
          stopReason: 'stop',
        },
      });

      // The final content must be exactly the last snapshot — NOT "HelHelloHello world".
      expect(updates[updates.length - 1]).toBe('Hello world');
      // No emitted content should ever contain a duplicated prefix.
      expect(updates.some(c => c.includes('HelHello') || c.includes('HelloHello'))).toBe(false);
    });

    it('should steer a truncated built-in write into the chunked workflow', async () => {
      await adapter.startSession('test', 'Write a large file');

      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: PiAssistantStopReason.Length,
          content: [
            {
              type: PiContentBlockType.ToolCall,
              id: 'write-1',
              name: PiBuiltinFileToolName.Write,
              arguments: { path: 'large.md', content: 'partial' },
            },
          ],
        },
      });

      expect(mockSession.steer).toHaveBeenCalledOnce();
      expect(mockSession.steer).toHaveBeenCalledWith(expect.stringContaining('2048 characters'));
    });

    it('persists a token reading only when the provider reported usage', async () => {
      const seededMessageIds: string[] = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') {
          seededMessageIds.push((msg as { id: string }).id);
        }
      });
      const updateMessage = vi.fn();
      // Only the members this metadata path reads.
      adapter.setCoworkStore({
        addMessage: (_sessionId: string, message: unknown) => message,
        getSession: () => ({ messages: seededMessageIds.map(id => ({ id, metadata: {} })) }),
        updateMessage,
      } as unknown as CoworkStore);
      mockSession.getContextUsage.mockReturnValue({ tokens: 1_200, contextWindow: 262_144 });

      await adapter.startSession('usage-session', 'Hi');

      const driveTurn = (usage: Record<string, number>): void => {
        listener!({ type: 'turn_start' });
        listener!({
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] },
        });
        listener!({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Answer' }],
            stopReason: 'stop',
            usage,
          },
        });
      };

      // The deferred context-usage sync is the last writer per turn; select its
      // writes by the contextUsage it stamps.
      const usageWrites = (): Array<Record<string, unknown>> =>
        updateMessage.mock.calls
          .map(call => (call[2] as { metadata?: Record<string, unknown> }).metadata)
          .filter(
            (metadata): metadata is Record<string, unknown> =>
              metadata !== undefined && 'contextUsage' in metadata,
          );

      // The provider reported nothing: Pi's zero-seeded default must not be
      // persisted, or the stats line renders "0 tok" as a real reading.
      driveTurn({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
      await vi.waitFor(() => expect(usageWrites()).toHaveLength(1));
      expect(usageWrites()[0]).not.toHaveProperty('usage');

      driveTurn({
        input: 900,
        output: 120,
        cacheRead: 300,
        cacheWrite: 0,
        reasoning: 60,
        totalTokens: 1_320,
      });
      await vi.waitFor(() => expect(usageWrites()).toHaveLength(2));
      expect(usageWrites()[1]?.usage).toEqual({
        inputTokens: 900,
        outputTokens: 120,
        cacheReadTokens: 300,
        cacheWriteTokens: 0,
        reasoningTokens: 60,
        totalTokens: 1_320,
      });
    });

    it('should mark an answer as final only after the agent run ends', async () => {
      const updates: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('messageUpdate', (_sid, _id, content, metadata) =>
        updates.push({ content, metadata }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Intermediate or final answer');

      expect(updates.some(update => update.metadata?.isFinalAnswer === true)).toBe(false);

      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });

      expect(updates[updates.length - 1]).toEqual({
        content: 'Intermediate or final answer',
        metadata: {
          isStreaming: false,
          isFinal: true,
          isFinalAnswer: true,
        },
      });
    });

    it('does not mark intermediate loop answers as final', async () => {
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Produce two iterations', {
        goalMode: true,
        sessionMode: 'work',
      });
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
      const loopTool = sessionOptions.customTools?.find(tool => tool.name === PiAgentLoopToolName);
      await loopTool!.execute('loop-start', {
        action: PiAgentLoopAction.Start,
        mode: PiAgentLoopMode.Passes,
        passes: 2,
      });

      driveAssistantTurn('First iteration answer');
      await loopTool!.execute('loop-next-1', {
        action: PiAgentLoopAction.Next,
        summary: 'First iteration complete',
      });
      listener!({ type: 'agent_end' });

      expect(
        updates.some(
          update =>
            update.content === 'First iteration answer' && update.metadata?.isFinalAnswer === true,
        ),
      ).toBe(false);

      driveAssistantTurn('Second iteration answer');
      await loopTool!.execute('loop-next-2', {
        action: PiAgentLoopAction.Next,
        summary: 'Second iteration complete',
      });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });

      const finalAnswers = updates.filter(update => update.metadata?.isFinalAnswer === true);
      expect(finalAnswers).toHaveLength(1);
      expect(finalAnswers[0].content).toBe('Second iteration answer');
      expect(
        new Set(
          updates
            .filter(update => update.content.endsWith('iteration answer'))
            .map(update => update.messageId),
        ).size,
      ).toBe(2);
    });

    it('should preserve the latest answer across a trailing thinking-only internal turn', async () => {
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Answer before trailing reasoning');
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking completion.' }],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking completion.' }],
          stopReason: 'length',
        },
      });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });

      expect(
        updates.some(
          update =>
            update.content === 'Answer before trailing reasoning' &&
            update.metadata?.isFinalAnswer === true,
        ),
      ).toBe(true);
    });

    it('should render thinking as a separate isThinking message, not as the answer', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('messageUpdate', (_sid, messageId, _c, metadata) =>
        updates.push({ messageId, metadata }),
      );

      await adapter.startSession('test', 'Think then answer');
      listener!({ type: 'turn_start' });
      // A snapshot containing both thinking and answer blocks.
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
          stopReason: 'stop',
        },
      });

      // Two distinct assistant messages: one thinking, one answer — with different ids.
      const thinkingMsg = messages.find(m => m.metadata?.isThinking === true);
      const answerMsg = messages.find(
        m =>
          m.metadata?.isThinking !== true &&
          (m.metadata as Record<string, unknown>)?.isStreaming !== undefined,
      );
      expect(thinkingMsg).toBeDefined();
      expect(answerMsg).toBeDefined();
      expect(thinkingMsg!.id).not.toBe(answerMsg!.id);

      // The thinking message must be finalized WITH isThinking:true (never as a plain answer).
      const thinkingFinal = updates.filter(u => u.messageId === thinkingMsg!.id).pop();
      expect(thinkingFinal?.metadata?.isThinking).toBe(true);
      expect(thinkingFinal?.metadata?.isFinal).toBe(true);
    });

    it('should persist runtime-measured duration for each thinking message', async () => {
      vi.useFakeTimers();
      try {
        const updates: Array<{ metadata?: Record<string, unknown> }> = [];
        adapter.on('messageUpdate', (_sid, _messageId, _content, metadata) =>
          updates.push({ metadata }),
        );

        await adapter.startSession('test', 'Measure thinking');
        listener!({ type: 'turn_start' });
        listener!({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
          },
        });
        vi.advanceTimersByTime(2400);
        listener!({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_end' },
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
          },
        });
        listener!({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting' }],
            stopReason: 'stop',
          },
        });

        const finalThinkingUpdate = updates.find(
          update => update.metadata?.isThinking === true && update.metadata?.isFinal === true,
        );
        expect(finalThinkingUpdate?.metadata?.thinkingDurationMs).toBe(2400);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
