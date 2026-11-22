/**
 * PiRuntimeAdapter unit tests: pending Work message queue and run completion
 * on agent_settled.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  createTestPiRuntime,
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

type NativeTestUserMessage = { role: 'user'; content: string };

function collectNativeFollowUps(): NativeTestUserMessage[] {
  const messages: NativeTestUserMessage[] = [];
  mockSession.followUp.mockImplementation(
    async (
      content: string,
      _images: unknown,
      options: {
        onQueued: (message: NativeTestUserMessage) => void;
      },
    ) => {
      const message: NativeTestUserMessage = { role: 'user', content };
      options.onQueued(message);
      messages.push(message);
      return 'queued';
    },
  );
  return messages;
}

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('pending Work messages', () => {
    it('delivers explicit steering directly without rebuilding accepted follow-ups', async () => {
      await adapter.startSession('native-queue', 'Start', { sessionMode: 'work' });
      adapter.enqueuePendingMessage('native-queue', 'Follow-up');
      expect((await adapter.steerInput('native-queue', 'First steer')).success).toBe(true);
      expect((await adapter.steerInput('native-queue', 'Second steer')).success).toBe(true);
      expect(mockSession.steer.mock.calls).toEqual([
        ['First steer', undefined, { onQueued: expect.any(Function) }],
        ['Second steer', undefined, { onQueued: expect.any(Function) }],
      ]);
      expect(mockSession.prompt.mock.calls).toEqual([['Start']]);
      expect(mockSession.followUp).toHaveBeenCalledWith('Follow-up', undefined, {
        onQueued: expect.any(Function),
      });
      expect(mockSession.clearQueue).not.toHaveBeenCalled();
    });

    it('stopping does not restart queued inputs and closes their metadata', async () => {
      await adapter.startSession('native-stop', 'Start', { sessionMode: 'work' });
      adapter.enqueuePendingMessage('native-stop', 'Follow-up');
      adapter.stopSession('native-stop');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(mockSession.followUp).toHaveBeenCalledTimes(1);
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
      const queued = collectNativeFollowUps();
      let listener:
        | ((event: { type: string; message?: { role: string; content: string } }) => void)
        | null = null;
      mockSession.subscribe.mockImplementation(
        (
          callback: (event: { type: string; message?: { role: string; content: string } }) => void,
        ) => {
          listener = callback;
          return () => {};
        },
      );
      const completes: string[] = [];
      adapter.on('complete', sid => completes.push(sid));
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });
      // Pi emits user message_start for the initial prompt first.
      listener!({ type: 'message_start', message: { role: 'user', content: 'Start work' } });

      const first = await adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      // Both follow-ups are dispatched immediately into Pi's native followUp queue.
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(mockSession.followUp.mock.calls).toEqual([
        ['First follow-up', undefined, { onQueued: expect.any(Function) }],
        ['Second follow-up', undefined, { onQueued: expect.any(Function) }],
      ]);
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(2);

      // Pi begins each queued follow-up natively with user message_start.
      listener!({ type: 'message_start', message: queued[0] });
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(1);
      listener!({ type: 'message_start', message: queued[1] });
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);

      // Pi emits agent_settled once after all native follow-ups complete.
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => expect(completes).toEqual(['queue-session']));
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(first.success).toBe(true);
    });

    it('merges a queued turn picks into the session skills without losing the session own', async () => {
      const nativeFollowUps = collectNativeFollowUps();
      const added: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      const appendSessionSkills = vi.fn();
      const adapter = createTestPiRuntime({
        coworkStore: {
          messages: {
            addMessage: (_sessionId: string, message: unknown) => {
              added.push(message as { content: string; metadata?: Record<string, unknown> });
              return message;
            },
            updateMessage: vi.fn(),
          },
          getSession: () => ({ messages: [], experts: [], activeSkillIds: ['alpha-skill'] }),
          updateSession: vi.fn(),
          appendSessionSkills,
          listSessionArtifacts: vi.fn(),
        } as unknown as CoworkStore,
      });

      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });

      await adapter.startSession('queued-skills', 'Start work', {
        sessionMode: 'work',
        skillIds: ['alpha-skill'],
      });
      const queued = await adapter.enqueuePendingMessage(
        'queued-skills',
        'Second',
        undefined,
        undefined,
        ['beta-skill'],
      );
      expect(queued.success).toBe(true);

      // A distinct native user message with identical text cannot activate the Skill.
      listener!({
        type: 'message_start',
        message: { role: 'user', content: 'Second' },
      } as { type: string });
      expect(appendSessionSkills).not.toHaveBeenCalled();
      expect(adapter.listPendingMessages('queued-skills')).toHaveLength(1);
      listener!({ type: 'message_start', message: nativeFollowUps[0] } as { type: string });
      expect(appendSessionSkills).toHaveBeenCalledExactlyOnceWith('queued-skills', ['beta-skill']);
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => expect(mockSession.followUp).toHaveBeenCalledTimes(1));

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

      await expect(
        adapter.enqueuePendingMessage('chat-session', 'Not allowed'),
      ).resolves.toMatchObject({
        success: false,
      });
    });

    it('recreates the native loadout on the first idle turn after a queued CAD attachment', async () => {
      await adapter.startSession('queued-cad', 'Start work', { sessionMode: 'work' });
      const active = adapter.activeSessions.get('queued-cad')!;
      active.isRunning = false;
      active.requestedSkillIds = ['text-to-cad'];
      active.resourceState.skillIds = ['text-to-cad'];
      active.resourceState.skillRoots = { 'text-to-cad': '/skills' };
      active.pendingCadToolReload = true;

      await adapter.continueSession('queued-cad', 'Open the viewer');

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    });

    it('isolates concurrent followUp callbacks across async handled commands without misattribution', async () => {
      const persisted: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      const agentFollowUpCalls: Array<{ role: string; content: string }> = [];
      let listener:
        | ((event: { type: string; message?: { role: string; content: string } }) => void)
        | null = null;
      const msg2 = { role: 'user', content: 'real user message' };
      const localAdapter = createTestPiRuntime({
        coworkStore: {
          messages: {
            addMessage: (_sessionId: string, message: unknown) => {
              persisted.push(message as { content: string; metadata?: Record<string, unknown> });
              return message;
            },
            updateMessage: vi.fn(),
          },
          getSession: () => ({ messages: [], experts: [] }),
          updateSession: vi.fn(),
          appendSessionSkills: vi.fn(),
          listSessionArtifacts: vi.fn(),
        } as unknown as CoworkStore,
      });
      try {
        mockSession.subscribe.mockImplementation(
          (
            callback: (event: {
              type: string;
              message?: { role: string; content: string };
            }) => void,
          ) => {
            listener = callback;
            return () => {};
          },
        );
        const mockAgent = {
          steer: vi.fn(),
          followUp: (message: { role: string; content: string }) => {
            agentFollowUpCalls.push(message);
          },
        };
        mockSession.followUp.mockImplementation(async (text: string) => {
          if (text.startsWith('/mycmd')) {
            await new Promise(resolve => setTimeout(resolve, 25));
            return 'handled' as const;
          }
          mockAgent.followUp(msg2);
          return 'queued' as const;
        });

        await localAdapter.startSession('race-session', 'Start', { sessionMode: 'work' });
        const active = localAdapter.activeSessions.get('race-session')!;
        (active.piSession as unknown as { agent: typeof mockAgent }).agent = mockAgent;

        const r1 = await localAdapter.enqueuePendingMessage(
          'race-session',
          '/mycmd',
          undefined,
          undefined,
          ['skill-a'],
        );
        const r2 = await localAdapter.enqueuePendingMessage(
          'race-session',
          'real user message',
          undefined,
          undefined,
          ['skill-b'],
        );
        expect(r1.success).toBe(true);
        expect(r2.success).toBe(true);

        listener!({ type: 'message_start', message: msg2 });
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(agentFollowUpCalls).toHaveLength(1);
        expect(persisted).toMatchObject([
          { type: 'user', content: 'Start' },
          {
            type: 'user',
            content: 'real user message',
            metadata: { skillIds: ['skill-b'], queueDelivery: 'followUp' },
          },
        ]);
        expect(persisted[0]?.metadata).toBeUndefined();
        const remaining = localAdapter.listPendingMessages('race-session');
        expect(remaining.some(item => item.text === 'real user message')).toBe(false);
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.status).toBe('failed');
      } finally {
        localAdapter.stopAllSessions();
      }
    });
  });

  describe('run completion on agent_settled', () => {
    it('resets memory dedup only after successful native compaction', async () => {
      await adapter.startSession('memory-compaction', 'Work', { sessionMode: 'work' });
      const block = 'Workspace:\n- [memory:1] Remember the verified decision';
      const listener = mockSession.subscribe.mock.calls.at(-1)![0];
      const original = adapter.memoryInjectionDedup.update('memory-compaction', block);
      expect(original).toContain(block);
      listener({ type: 'compaction_end', aborted: false, errorMessage: 'failed' });
      expect(adapter.memoryInjectionDedup.update('memory-compaction', '')).toBe(original);
      listener({ type: 'compaction_end', aborted: false, result: { summary: 'checkpoint' } });
      expect(adapter.memoryInjectionDedup.update('memory-compaction', '')).toBeNull();
      expect(mockSession.prompt).toHaveBeenCalledOnce();
    });

    it('retains the active memory window when native preflight rejects a continuation', async () => {
      const sessionId = 'memory-failed-continuation';
      await adapter.startSession(sessionId, 'Work', { sessionMode: 'work' });
      const active = adapter.activeSessions.get(sessionId)!;
      active.isRunning = false;
      const block = 'Workspace:\n- [memory:1] Remember the verified decision';
      const original = adapter.memoryInjectionDedup.update(sessionId, block);
      const error = new Error('Native preflight failed');
      mockSession.prompt.mockRejectedValueOnce(error);
      adapter.on('error', vi.fn());

      await expect(adapter.continueSession(sessionId, 'Next')).rejects.toThrow(error);
      expect(active.pendingTurnMemory).toBeUndefined();
      expect(adapter.memoryInjectionDedup.update(sessionId, '')).toBe(original);
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
      const adapter = createTestPiRuntime({ workbenchTaskService: service });
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
