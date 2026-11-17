/**
 * PiRuntimeAdapter unit tests: pending Work message queue and run completion
 * on agent_settled.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchApprovalMode, WorkbenchExecutionStatus } from '../../../shared/workbenchTask';
import { PiExtensionEventType } from './piExtensionTypes';
import { type CoworkError } from '../../../common/coworkError';
import type { CoworkStore } from '../../coworkStore';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('pending Work messages', () => {
    it('delivers explicit steering directly without rebuilding accepted follow-ups', async () => {
      await adapter.startSession('native-queue', 'Start', { sessionMode: 'work' });
      adapter.enqueuePendingMessage('native-queue', 'Follow-up');
      expect((await adapter.steerInput('native-queue', 'First steer')).success).toBe(true);
      expect((await adapter.steerInput('native-queue', 'Second steer')).success).toBe(true);
      expect(mockSession.steer.mock.calls).toEqual([['First steer'], ['Second steer']]);
      expect(mockSession.prompt.mock.calls).toEqual([
        ['Start'],
        ['Follow-up', { streamingBehavior: 'followUp' }],
      ]);
      expect(mockSession.clearQueue).not.toHaveBeenCalled();
    });

    it('stopping does not restart queued inputs and closes their metadata', async () => {
      await adapter.startSession('native-stop', 'Start', { sessionMode: 'work' });
      adapter.enqueuePendingMessage('native-stop', 'Follow-up');
      adapter.stopSession('native-stop');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
      expect(adapter.isSessionRunning('native-stop')).toBe(false);
      expect(adapter.listPendingMessages('native-stop')).toEqual([]);
    });

    it('preserves Allow All across internal follow-up continuations', async () => {
      await adapter.startSession('allow-all-session', 'Start work', {
        sessionMode: 'work',
        approvalMode: WorkbenchApprovalMode.AllowAll,
      });

      await adapter.continueSession('allow-all-session', 'Continue work', {
        sessionMode: 'work',
      });

      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { approvalMode: WorkbenchApprovalMode }>;
        }
      ).activeSessions;
      expect(activeSessions.get('allow-all-session')?.approvalMode).toBe(
        WorkbenchApprovalMode.AllowAll,
      );
    });

    it('dispatches queued follow-ups natively and consumes them on Pi message_start before agent_settled', async () => {
      let listener: ((event: { type: string; message?: { role: string } }) => void) | null = null;
      mockSession.subscribe.mockImplementation(
        (callback: (event: { type: string; message?: { role: string } }) => void) => {
          listener = callback;
          return () => {};
        },
      );
      const completes: string[] = [];
      adapter.on('complete', sid => completes.push(sid));
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });
      // Pi emits user message_start for the initial prompt first.
      listener!({ type: 'message_start', message: { role: 'user' } });

      const first = adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      // Both follow-ups are dispatched immediately into Pi's native followUp queue.
      expect(mockSession.prompt).toHaveBeenCalledTimes(3);
      expect(mockSession.prompt.mock.calls.slice(1)).toEqual([
        ['First follow-up', { streamingBehavior: 'followUp' }],
        ['Second follow-up', { streamingBehavior: 'followUp' }],
      ]);
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(2);

      // Pi begins each queued follow-up natively with user message_start.
      listener!({ type: 'message_start', message: { role: 'user' } });
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(1);
      listener!({ type: 'message_start', message: { role: 'user' } });
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);

      // Pi emits agent_settled once after all native follow-ups complete.
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => expect(completes).toEqual(['queue-session']));
      expect(mockSession.prompt).toHaveBeenCalledTimes(3);
      expect(first.success).toBe(true);
    });

    it('merges a queued turn picks into the session skills without losing the session own', async () => {
      const added: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      adapter.setCoworkStore({
        addMessage: (_sessionId: string, message: unknown) => {
          added.push(message as { content: string; metadata?: Record<string, unknown> });
          return message;
        },
        getSession: () => ({ messages: [], experts: [] }),
        updateSession: vi.fn(),
        updateMessage: vi.fn(),
        listSessionArtifacts: vi.fn(),
      } as unknown as CoworkStore);

      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });

      await adapter.startSession('queued-skills', 'Start work', {
        sessionMode: 'work',
        skillIds: ['alpha-skill'],
      });
      const queued = adapter.enqueuePendingMessage(
        'queued-skills',
        'Second',
        undefined,
        undefined,
        ['beta-skill'],
      );
      expect(queued.success).toBe(true);

      listener!({ type: 'message_start', message: { role: 'user' } } as { type: string });
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(2));

      // The queued turn records only its own pick as the input attachment…
      expect(added.map(message => message.metadata?.skillIds)).toEqual([undefined, ['beta-skill']]);

      // …while the session keeps running with both skills loaded for the model.
      const loader = mockDefaultResourceLoader.mock.calls.at(-1)?.[0] as {
        skillsOverride: (base: { skills: Array<{ id: string }>; diagnostics: unknown[] }) => {
          skills: Array<{ id: string }>;
        };
      };
      const visible = loader.skillsOverride({
        skills: [{ id: 'alpha-skill' }, { id: 'beta-skill' }, { id: 'other' }],
        diagnostics: [],
      });
      expect(visible.skills.map(skill => skill.id)).toEqual(['alpha-skill', 'beta-skill']);
    });

    it('rejects queue controls for Chat sessions', async () => {
      await adapter.startSession('chat-session', 'Hello', { sessionMode: 'chat' });

      expect(adapter.enqueuePendingMessage('chat-session', 'Not allowed')).toMatchObject({
        success: false,
      });
    });
  });

  describe('run completion on agent_settled', () => {
    it('resets memory dedup only after successful native compaction', async () => {
      await adapter.startSession('memory-compaction', 'Work', { sessionMode: 'work' });
      const block = 'Workspace:\n- [memory:1] Remember the verified decision';
      const listener = mockSession.subscribe.mock.calls.at(-1)![0];
      expect(adapter.memoryInjectionDedup.take('memory-compaction', block)).toBeTruthy();
      listener({ type: 'compaction_end', aborted: false, errorMessage: 'failed' });
      expect(adapter.memoryInjectionDedup.take('memory-compaction', block)).toBeNull();
      listener({ type: 'compaction_end', aborted: false, result: { summary: 'checkpoint' } });
      expect(adapter.memoryInjectionDedup.take('memory-compaction', block)).toBeTruthy();
      expect(mockSession.prompt).toHaveBeenCalledOnce();
    });

    const assistantTurn = (
      listener: (event: {
        type: string;
        message?: { role: string; content: Array<Record<string, unknown>>; stopReason?: string };
      }) => void,
      text: string,
    ) => {
      listener({ type: 'turn_start' });
      listener({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
    };

    it('keeps the run alive through an SDK compaction continuation and completes it at agent_settled', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const completes: string[] = [];
      adapter.on('complete', sessionId => completes.push(sessionId));
      const errors: CoworkError[] = [];
      adapter.on('error', (_sessionId, error) => errors.push(error));
      try {
        await adapter.startSession('compaction-resume', 'Write a long report', {
          sessionMode: 'work',
          approvalMode: WorkbenchApprovalMode.AllowAll,
        });
        const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
          extensionFactories?: Array<
            (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
          >;
        };
        const toolCallHandlers: Array<(event: unknown) => Promise<unknown>> = [];
        for (const factory of loaderOptions.extensionFactories ?? []) {
          factory({
            on: (event, handler) => {
              if (event === PiExtensionEventType.ToolCall) {
                toolCallHandlers.push(handler as (event: unknown) => Promise<unknown>);
              }
            },
          });
        }
        const listener = mockSession.subscribe.mock.calls.at(-1)![0] as (event: {
          type: string;
          message?: { role: string; content: Array<Record<string, unknown>>; stopReason?: string };
          reason?: string;
          aborted?: boolean;
        }) => void;
        const taskId = service.getCurrent('compaction-resume')!.task.id;

        listener({ type: 'agent_start' });
        assistantTurn(listener, 'Draft before compaction');
        listener({ type: 'agent_end' });

        // agent_end is not terminal: the SDK compacts and continues on its own,
        // so the run must stay alive and no completion may fire yet.
        expect(service.getDetail(taskId)?.runs[0]?.status).toBe(WorkbenchExecutionStatus.Running);
        expect(completes).toHaveLength(0);

        listener({ type: 'compaction_start', reason: 'threshold' });
        listener({ type: 'compaction_end', reason: 'threshold', aborted: false });
        listener({ type: 'turn_start' });

        // The continuation turn's tool calls still proceed normally without aborting Pi.
        const authorization = await toolCallHandlers.at(-1)!({
          toolCallId: 'post-compaction-call',
          toolName: 'bash',
          input: { command: 'ls -la' },
        });
        expect(authorization).toBeUndefined();

        assistantTurn(listener, 'Final report after compaction');
        listener({ type: 'agent_end' });
        expect(service.getDetail(taskId)?.runs[0]?.status).toBe(WorkbenchExecutionStatus.Running);
        expect(completes).toHaveLength(0);

        listener({ type: 'agent_settled' });
        await vi.waitFor(() => expect(completes).toHaveLength(1));
        expect(service.getDetail(taskId)?.runs[0]?.status).toBe(WorkbenchExecutionStatus.Settled);
        expect(errors).toHaveLength(0);
      } finally {
        adapter.stopAllSessions();
        db.close();
      }
    });
  });
});
