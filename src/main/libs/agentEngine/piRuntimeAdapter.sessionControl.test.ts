/**
 * PiRuntimeAdapter unit tests: session control (stop, activity, confirmation
 * mode, patching).
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockModelRuntime,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import type { CoworkStore } from '../../coworkStore';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('stopSession', () => {
    it('keeps agent-backed chat interruptions on the normal continuation path', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const interruptions: Array<{ taskId: string | null; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('chat-session', 'Hello', { sessionMode: 'chat' });
        adapter.stopSession('chat-session');

        expect(interruptions).toEqual([
          expect.objectContaining({ taskId: null, recoverable: false }),
        ]);
      } finally {
        db.close();
      }
    });

    it('cancels a session while the runtime is still initializing', async () => {
      let resolveCreateSession: ((value: { session: typeof mockSession }) => void) | undefined;
      mockCreateAgentSession.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCreateSession = resolve;
          }),
      );
      const interruptions: Array<{ cause: string }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      const startPromise = adapter.startSession('initializing', 'Hello');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledOnce());
      adapter.stopSession('initializing');
      resolveCreateSession?.({ session: mockSession });
      await startPromise;

      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(adapter.isSessionActive('initializing')).toBe(false);
      expect(interruptions).toEqual([
        expect.objectContaining({ cause: CoworkInterruptionCause.UserStop }),
      ]);
    });

    it('should keep session entry active (preserves IM routing) but mark it aborted', async () => {
      await adapter.startSession('test', 'Hello');
      const addMessage = vi.fn(
        (_sessionId: string, message: Parameters<CoworkStore['addMessage']>[1]) => ({
          ...message,
          id: 'persisted-interruption',
          timestamp: Date.now(),
        }),
      );
      const updateSession = vi.fn();
      adapter.setCoworkStore({ addMessage, updateSession } as unknown as CoworkStore);
      const interruptions: Array<{ cause: string; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));
      adapter.stopSession('test');
      adapter.stopSession('test');
      // Drop the heavy Pi session after stop, but keep a lightweight retention
      // marker so isSessionActive still reports true for IM routing.
      const internals = adapter as unknown as {
        activeSessions: Map<string, unknown>;
        retainedSessionIds: Set<string>;
      };
      expect(internals.activeSessions.has('test')).toBe(false);
      expect(internals.retainedSessionIds.has('test')).toBe(true);
      expect(adapter.isSessionActive('test')).toBe(true);
      expect(mockSession.abort).toHaveBeenCalled();
      expect(addMessage).toHaveBeenCalledOnce();
      expect(addMessage).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          type: 'system',
          metadata: {
            interruption: expect.objectContaining({
              cause: CoworkInterruptionCause.UserStop,
              recoverable: false,
            }),
          },
        }),
      );
      expect(updateSession).toHaveBeenCalledWith('test', { status: 'idle' });
      expect(interruptions).toEqual([
        expect.objectContaining({
          cause: CoworkInterruptionCause.UserStop,
          recoverable: false,
        }),
      ]);
    });

    it('should cause continueSession to reconstruct after stop', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.stopSession('test');
      await adapter.continueSession('test', 'Next');
      // After stop, continueSession must not reuse the aborted Pi session.
      // It reconstructs from store history, creating a fresh Pi session.
      expect(mockSession.subscribe).toHaveBeenCalledTimes(2);
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    });

    it('closes in-flight tool calls so resume does not show two running commands', async () => {
      await adapter.startSession('paused-tools', 'Run a command');
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [
        {
          id: 'tool-use-1',
          type: 'tool_use',
          content: 'Using tool: bash',
          metadata: {
            toolName: 'bash',
            toolUseId: 'call-bash-1',
            toolInput: { command: 'npm test' },
          },
        },
      ];
      const addMessage = vi.fn(
        (_sessionId: string, message: { type: string; metadata?: unknown }) => {
          const persisted = { ...message, id: `persisted-${message.type}`, timestamp: Date.now() };
          messages.push(persisted as (typeof messages)[number]);
          return persisted;
        },
      );
      adapter.setCoworkStore({
        getSessionMessagesDesc: (_sessionId: string, limit: number, offset: number) =>
          [...messages].reverse().slice(offset, offset + limit),
        addMessage,
        updateSession: vi.fn(),
      } as unknown as CoworkStore);

      adapter.stopSession('paused-tools');

      const toolResults = addMessage.mock.calls
        .map(call => call[1] as { type: string; metadata?: { toolUseId?: string; error?: string } })
        .filter(message => message.type === 'tool_result');
      expect(toolResults).toEqual([
        expect.objectContaining({
          type: 'tool_result',
          metadata: expect.objectContaining({
            toolUseId: 'call-bash-1',
            error: 'interrupted',
            isError: true,
          }),
        }),
      ]);
    });

    it('should be safe to call on unknown session', () => {
      adapter.stopSession('unknown');
      // Should not throw
    });
  });

  describe('stopAllSessions', () => {
    it('cancels sessions that are still initializing', async () => {
      let resolveCreateSession: ((value: { session: typeof mockSession }) => void) | undefined;
      mockCreateAgentSession.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCreateSession = resolve;
          }),
      );

      const startPromise = adapter.startSession('initializing', 'Hello');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledOnce());
      adapter.stopAllSessions();
      resolveCreateSession?.({ session: mockSession });
      await startPromise;

      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
    });

    it('should keep all sessions active (preserves history)', async () => {
      await adapter.startSession('s1', 'A');
      await adapter.startSession('s2', 'B');
      adapter.stopAllSessions();
      // Lightweight retention keeps IM routing alive without holding Pi sessions.
      const internals = adapter as unknown as {
        activeSessions: Map<string, unknown>;
        retainedSessionIds: Set<string>;
      };
      expect(internals.activeSessions.size).toBe(0);
      expect(internals.retainedSessionIds.has('s1')).toBe(true);
      expect(internals.retainedSessionIds.has('s2')).toBe(true);
      expect(adapter.isSessionActive('s1')).toBe(true);
      expect(adapter.isSessionActive('s2')).toBe(true);
    });
  });

  // ── Session state ──

  describe('isSessionActive', () => {
    it('should return false for unknown session', () => {
      expect(adapter.isSessionActive('nope')).toBe(false);
    });
  });

  describe('getSessionConfirmationMode', () => {
    it('should return null for unknown session', () => {
      expect(adapter.getSessionConfirmationMode('nope')).toBeNull();
    });

    it('should return modal by default', async () => {
      await adapter.startSession('test', 'Hello');
      expect(adapter.getSessionConfirmationMode('test')).toBe('modal');
    });

    it('should return text when Chat mode is set', async () => {
      await adapter.startSession('test', 'Hello', { confirmationMode: 'text' });
      expect(adapter.getSessionConfirmationMode('test')).toBe('text');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()).toEqual([
        PiAskUserQuestionSystemPrompt,
        DeclareArtifactSystemPrompt,
      ]);
    });
  });

  // ── Model updates ──

  describe('patchSession', () => {
    it('should update the model and reload its write budget when the output limit changes', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', { model: 'openai/gpt-5.2' });
      expect(mockSession.setModel).toHaveBeenCalled();
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'magpie',
        expect.objectContaining({
          models: [expect.objectContaining({ id: 'openai/gpt-5.2' })],
        }),
      );
      expect(mockSession.reload).toHaveBeenCalledOnce();

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()).toEqual(
        expect.arrayContaining([expect.stringContaining('8000 characters')]),
      );
    });

    it('should not call setModel when no model in patch', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', {});
      expect(mockSession.setModel).not.toHaveBeenCalled();
    });

    it('should update the thinking level without touching the model', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', { thinkingLevel: 'high' });
      expect(mockSession.setThinkingLevel).toHaveBeenCalledWith('high');
      expect(mockSession.setModel).not.toHaveBeenCalled();
    });

    it('should pass the thinking level when creating the Pi session', async () => {
      await adapter.startSession('test-thinking', 'Hello', { thinkingLevel: 'low' });
      const sessionOptions = mockCreateAgentSession.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(sessionOptions.thinkingLevel).toBe('low');
    });

    it('should be a no-op for unknown session', async () => {
      await expect(adapter.patchSession('nope', { model: 'x' })).resolves.not.toThrow();
    });
  });
});
