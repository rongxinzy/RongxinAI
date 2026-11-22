/**
 * PiRuntimeAdapter unit tests: session control (stop, activity, confirmation
 * mode, patching).
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  createTestPiRuntime,
  adapter,
  applyTestResolution,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockModelRuntime,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { CoworkSessionStatus } from '../../../shared/cowork/constants';
import { ScheduledTaskAvailabilityGuidance } from '../../../scheduledTask/enginePrompt';
import type { CoworkStore } from '../../coworkStore';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  it('refuses new sessions and follow-ups once application shutdown starts', async () => {
    await adapter.shutdown().drained;
    await expect(adapter.startSession('late', 'hello')).rejects.toThrow('shutting down');
    await expect(adapter.continueSession('late', 'hello')).rejects.toThrow('shutting down');
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  describe('stopSession', () => {
    it('keeps agent-backed chat interruptions on the normal continuation path', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      const adapter = createTestPiRuntime({ workbenchTaskService: service });
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
      const onStopped = vi.fn();
      adapter.on('sessionStopped', onStopped);
      const onSettled = vi.fn();

      const startPromise = adapter.startSession('initializing', 'Hello', { onSettled });
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledOnce());
      expect(adapter.isSessionRunning('initializing')).toBe(true);
      expect(adapter.getRunningSessionIds()).toEqual(['initializing']);
      await expect(adapter.startSession('initializing', 'Replacement')).rejects.toThrow(
        'A Pi run is already active in this session.',
      );
      await expect(adapter.continueSession('initializing', 'Replacement')).rejects.toThrow(
        'A Pi run is already active in this session.',
      );
      adapter.stopSession('initializing');
      resolveCreateSession?.({ session: mockSession });
      await startPromise;

      expect(adapter.getRunningSessionIds()).toEqual([]);
      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(mockSession.bindExtensions).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalledOnce();
      expect(adapter.isSessionActive('initializing')).toBe(false);
      expect(onStopped).toHaveBeenCalledExactlyOnceWith('initializing');
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: false, error: expect.any(String) });
      expect(interruptions).toEqual([
        expect.objectContaining({ cause: CoworkInterruptionCause.UserStop }),
      ]);
    });

    it('keeps interactive input out of an unattended run that will deliver a result', async () => {
      await adapter.startSession('scheduled', 'Scheduled report', {
        sessionMode: 'work',
        unattended: true,
        onSettled: vi.fn(),
      });

      await expect(adapter.enqueuePendingMessage('scheduled', 'Follow up')).resolves.toMatchObject({
        success: false,
      });
      await expect(adapter.steerInput('scheduled', 'Interrupt')).resolves.toMatchObject({
        success: false,
      });
      expect(adapter.listPendingMessages('scheduled')).toEqual([]);
      expect(mockSession.steer).not.toHaveBeenCalled();
    });

    it('records stopping a new initialization even when the previous turn was stopped', async () => {
      await adapter.startSession('resume-stopped', 'First request');
      adapter.stopSession('resume-stopped');
      const starting = Promise.withResolvers<void>();
      const pendingSession = Promise.withResolvers<{ session: typeof mockSession }>();
      mockCreateAgentSession.mockImplementationOnce(() => {
        starting.resolve();
        return pendingSession.promise;
      });
      const interrupted = vi.fn();
      adapter.on('sessionInterrupted', interrupted);

      const resumed = adapter.continueSession('resume-stopped', 'New request');
      await starting.promise;
      adapter.stopSession('resume-stopped');
      adapter.stopSession('resume-stopped');
      pendingSession.resolve({ session: mockSession });
      await resumed;

      expect(interrupted).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ cause: CoworkInterruptionCause.UserStop }),
      );
    });

    it('holds scheduled submission ownership during reload and drops its error after stop', async () => {
      await adapter.startSession('scheduled', 'Previous report', { unattended: true });
      const listener = mockSession.subscribe.mock.calls.at(-1)![0];
      listener({ type: 'agent_settled' });
      const reload = Promise.withResolvers<void>();
      mockSession.reload.mockReturnValueOnce(reload.promise);
      const onSettled = vi.fn();
      const onError = vi.fn();
      adapter.on('error', onError);

      const scheduled = adapter.continueSession('scheduled', 'New report', {
        unattended: true,
        onSettled,
        systemPrompt: 'Updated instructions',
      });
      await vi.waitFor(() => expect(mockSession.reload).toHaveBeenCalledOnce());
      await expect(adapter.continueSession('scheduled', 'Interactive input')).rejects.toThrow(
        'A Pi run is already active in this session.',
      );

      adapter.stopSession('scheduled');
      await adapter.startSession('scheduled', 'Replacement');
      reload.reject(new Error('The stopped session reload failed'));

      await expect(scheduled).resolves.toBeUndefined();
      expect(onError).not.toHaveBeenCalled();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: false, error: expect.any(String) });
      expect(adapter.isSessionRunning('scheduled')).toBe(true);
    });

    it('holds a failed scheduled run until native settlement after retry exhaustion', async () => {
      const onSettled = vi.fn();
      const onError = vi.fn();
      adapter.on('error', onError);
      await adapter.startSession('scheduled', 'New report', { unattended: true, onSettled });
      const listener = mockSession.subscribe.mock.calls.at(-1)![0];

      listener({ type: 'auto_retry_end', success: false, finalError: 'Service unavailable' });
      expect(onError).not.toHaveBeenCalled();
      expect(adapter.isSessionRunning('scheduled')).toBe(true);
      await expect(
        adapter.continueSession('scheduled', 'Another report', { unattended: true, onSettled }),
      ).rejects.toThrow('A Pi run is already active in this session.');

      listener({ type: 'agent_settled' });
      expect(adapter.isSessionRunning('scheduled')).toBe(false);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: 'Service unavailable',
      });
    });

    it('should keep session entry active (preserves IM routing) but mark it aborted', async () => {
      const addMessage = vi.fn(
        (_sessionId: string, message: Parameters<CoworkStore['messages']['addMessage']>[1]) => ({
          ...message,
          id: 'persisted-interruption',
          timestamp: Date.now(),
        }),
      );
      const updateSession = vi.fn();
      const adapter = createTestPiRuntime({
        coworkStore: {
          messages: { addMessage },
          getSession: vi.fn(),
          updateSession,
        } as unknown as CoworkStore,
      });
      await adapter.startSession('test', 'Hello', { skipInitialUserMessage: true });
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
        expect.any(Number),
        CoworkSessionStatus.Idle,
      );
      expect(updateSession).not.toHaveBeenCalled();
      expect(interruptions).toEqual([
        expect.objectContaining({
          cause: CoworkInterruptionCause.UserStop,
          recoverable: false,
        }),
      ]);
    });

    it('stopAllSessions (quit path) ends liveness without persisting a session status', async () => {
      const addMessage = vi.fn(
        (_sessionId: string, message: Parameters<CoworkStore['messages']['addMessage']>[1]) => ({
          ...message,
          id: 'persisted-message',
          timestamp: Date.now(),
        }),
      );
      const updateSession = vi.fn();
      const adapter = createTestPiRuntime({
        coworkStore: {
          messages: { addMessage },
          getSession: vi.fn(),
          updateSession,
        } as unknown as CoworkStore,
      });
      await adapter.startSession('quit-session', 'Hello', { skipInitialUserMessage: true });
      const interruptions: unknown[] = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));
      updateSession.mockClear();

      adapter.stopAllSessions();

      expect(addMessage).not.toHaveBeenCalled();
      expect(interruptions).toEqual([]);
      expect(updateSession).not.toHaveBeenCalled();
      expect(adapter.isSessionRunning('quit-session')).toBe(false);
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
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      const addMessage = vi.fn(
        (_sessionId: string, message: { type: string; metadata?: unknown }) => {
          const persisted = { ...message, id: `persisted-${message.type}`, timestamp: Date.now() };
          messages.push(persisted as (typeof messages)[number]);
          return persisted;
        },
      );
      const adapter = createTestPiRuntime({
        coworkStore: {
          messages: {
            listOpenToolUseIds: () =>
              messages
                .filter(message => message.type === 'tool_use')
                .map(message => message.metadata?.toolUseId),
            addMessage,
          },
          getSession: vi.fn(),
          updateSession: vi.fn(),
        } as unknown as CoworkStore,
      });
      await adapter.startSession('paused-tools', 'Run a command', { skipInitialUserMessage: true });
      messages.push({
        id: 'tool-use-1',
        type: 'tool_use',
        content: 'Using tool: bash',
        metadata: {
          toolName: 'bash',
          toolUseId: 'call-bash-1',
          toolInput: { command: 'npm test' },
        },
      });
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

    it('clears pending context usage scheduled before stop', async () => {
      vi.useFakeTimers();
      const updateMessage = vi.fn();
      const messages: Array<{
        id: string;
        type: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      const addMessage = vi.fn(
        (
          _sessionId: string,
          message: { type: string; content?: string; metadata?: Record<string, unknown> },
        ) => {
          const persisted = {
            ...message,
            id: `msg-${messages.length + 1}`,
            content: message.content ?? '',
            timestamp: Date.now(),
          };
          messages.push(persisted);
          return persisted;
        },
      );
      const adapter = createTestPiRuntime({
        coworkStore: {
          messages: { addMessage, updateMessage },
          getSession: (sessionId: string) => ({ id: sessionId, messages }),
          updateSession: vi.fn(),
        } as unknown as CoworkStore,
      });

      await adapter.startSession('usage-stop', 'Hello');
      messages.push({
        id: 'assistant-usage-1',
        type: 'assistant',
        content: 'partial',
        metadata: { isStreaming: true },
      });
      adapter.transcript.scheduleContextUsageSync(
        'usage-stop',
        'assistant-usage-1',
        { input: 12, output: 3, cacheRead: 0, cacheWrite: 0, total: 15 },
        'test-model',
        Date.now(),
        Date.now(),
      );
      adapter.stopSession('usage-stop');
      adapter.transcript.flushContextUsageSync('usage-stop');
      vi.advanceTimersByTime(5_000);
      const wroteDeferredUsage = updateMessage.mock.calls.some(call => {
        const metadata = (call[2] as { metadata?: Record<string, unknown> } | undefined)?.metadata;
        return Boolean(metadata?.contextUsage || metadata?.usage);
      });
      expect(wroteDeferredUsage).toBe(false);
      vi.useRealTimers();
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
      expect(mockSession.bindExtensions).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalledOnce();
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
        ScheduledTaskAvailabilityGuidance,
      ]);
    });
  });

  // ── Model updates ──

  describe('patchSession', () => {
    it('keeps the active Work model when Magpie rejects a smaller replacement', async () => {
      applyTestResolution({
        config: { model: 'large-audit' },
        providerMetadata: { contextWindow: 32768 },
      });
      await adapter.startSession('work-model', 'Work');
      const active = adapter.activeSessions.get('work-model')!;
      const originalModel = active.model;
      applyTestResolution({
        config: { model: 'small-audit' },
        providerMetadata: { contextWindow: 8192 },
      });

      await expect(adapter.patchSession('work-model', { model: 'small-audit' })).rejects.toThrow(
        /8192/,
      );
      expect(mockSession.setModel).not.toHaveBeenCalled();
      expect(active.model).toBe(originalModel);
    });

    it('passes a smaller model to Pi without retaining host compaction overrides', async () => {
      applyTestResolution({
        config: { model: 'large-audit' },
        providerMetadata: { contextWindow: 131072, maxTokens: 4096 },
      });
      await adapter.startSession('shrink-context', 'Work');
      const active = adapter.activeSessions.get('shrink-context')!;
      const overrides = vi.spyOn(active.settingsManager!, 'applyOverrides');
      overrides.mockClear();
      applyTestResolution({
        config: { model: 'small-audit' },
        providerMetadata: { contextWindow: 16384, maxTokens: 4096 },
      });
      await adapter.patchSession('shrink-context', { model: 'small-audit' });
      expect(mockSession.setModel).toHaveBeenCalledWith(
        expect.objectContaining({ contextWindow: 16384 }),
      );
      expect(overrides).not.toHaveBeenCalledWith(
        expect.objectContaining({ compaction: expect.anything() }),
      );
      expect(mockSession.reload).not.toHaveBeenCalled();
    });
    it('should update the model and reload its write budget when the output limit changes', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', { model: 'openai/gpt-5.2' });
      expect(mockSession.setModel).toHaveBeenCalled();
      expect(mockModelRuntime.registerNativeProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'magpie',
          models: [expect.objectContaining({ id: 'openai/gpt-5.2' })],
        }),
      );
      expect(mockSession.reload).toHaveBeenCalledOnce();

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.appendSystemPromptOverride()).toEqual(
        expect.not.arrayContaining([expect.stringContaining('2000 characters')]),
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
