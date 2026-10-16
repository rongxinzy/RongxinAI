/**
 * PiRuntimeAdapter unit tests: tool execution event mapping.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import { adapter, mockSession, setupPiRuntimeAdapterSuite } from './piRuntimeAdapter.testHarness';

import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../../shared/cowork/toolActivity';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('tool execution event mapping', () => {
    // Capture the Pi event listener so we can drive events manually.
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    it('should emit a tool_use message on tool_execution_start', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'Bash',
        args: { command: 'ls' },
      });

      const toolUse = messages.find(m => m.type === 'tool_use');
      expect(toolUse).toBeDefined();
      expect(toolUse!.metadata?.toolName).toBe('Bash');
      expect(toolUse!.metadata?.toolUseId).toBe('call-1');
      expect(toolUse!.metadata?.toolInput).toEqual({ command: 'ls' });
    });

    it('emits a bounded Write summary while arguments are still streaming', async () => {
      const events: Array<{ kind: string; payload: unknown }> = [];
      adapter.on('toolActivity', (_sessionId, event) => {
        events.push({ kind: 'activity', payload: event });
      });
      adapter.on('message', (_sessionId, message) => {
        if (message.type === 'tool_use') events.push({ kind: 'tool_use', payload: message });
      });
      await adapter.startSession('test', 'Write a file');

      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'write-1',
              name: 'Write',
              arguments: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
            },
          ],
        },
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          partial: {
            content: [
              {
                type: 'toolCall',
                id: 'write-1',
                name: 'Write',
                arguments: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
              },
            ],
          },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'activity',
        payload: {
          type: CoworkToolActivityEventType.Upsert,
          activity: {
            toolCallId: 'write-1',
            phase: CoworkToolActivityPhase.Preparing,
            toolName: 'Write',
            toolInput: { path: 'src/app.ts' },
          },
        },
      });

      listener!({
        type: 'tool_execution_start',
        toolCallId: 'write-1',
        toolName: 'Write',
        args: { path: 'src/app.ts', content: 'x'.repeat(10_000) },
      });

      expect(events.at(-1)?.kind).toBe('tool_use');
    });

    it('should emit a linked tool_result message on tool_execution_end', async () => {
      const messages: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> =
        [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'Bash', args: {} });
      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'file1.txt\nfile2.txt',
        isError: false,
      });
      await vi.waitFor(() => expect(messages.some(m => m.type === 'tool_result')).toBe(true));
      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!.metadata?.toolUseId).toBe('call-1');
      expect(toolResult!.metadata?.isError).toBe(false);
      expect(toolResult!.content).toContain('file1.txt');
    });

    it('should not emit duplicate tool_result for the same call', async () => {
      const results: unknown[] = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'tool_result') results.push(msg);
      });
      await adapter.startSession('test', 'Do something');

      const endEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'x',
        isError: false,
      };
      listener!(endEvent);
      listener!(endEvent);

      expect(results).toHaveLength(1);
    });

    it('should flag tool_result as error when isError is true', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-err',
        toolName: 'Bash',
        result: 'command not found',
        isError: true,
      });

      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult!.metadata?.isError).toBe(true);
    });

    it('should flag tool_result as error when result details contain isError', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-details-err',
        toolName: 'declare_artifact',
        result: {
          content: [{ type: 'text', text: 'file does not exist' }],
          details: { isError: true, error: 'file does not exist' },
        },
        isError: false,
      });
      await vi.waitFor(() => expect(messages.some(m => m.type === 'tool_result')).toBe(true));
      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult!.metadata?.isError).toBe(true);
    });
  });
});
