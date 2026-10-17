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
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { type CoworkError } from '../../../common/coworkError';
import type { CoworkStore } from '../../coworkStore';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('pending Work messages', () => {
    it('queues follow-ups during a running Work session and steers on demand', async () => {
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });

      const queued = adapter.enqueuePendingMessage('queue-session', 'Change direction');
      expect(queued.success).toBe(true);
      expect(adapter.listPendingMessages('queue-session')).toHaveLength(1);

      const steered = await adapter.steerPendingMessage('queue-session', queued.item!.id);
      expect(steered.success).toBe(true);
      expect(mockSession.prompt).toHaveBeenCalledWith('Change direction', {
        streamingBehavior: 'steer',
      });
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);
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

    it('delivers queued follow-ups in order after Pi settles', async () => {
      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });
      const first = adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenLastCalledWith('First follow-up', {
          streamingBehavior: 'followUp',
        });
      });
      // Each follow-up turn ends with its own agent_end + agent_settled pair,
      // which releases the next queued item.
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenCalledTimes(3);
      });
      expect(mockSession.prompt.mock.calls.slice(1)).toEqual([
        ['First follow-up', { streamingBehavior: 'followUp' }],
        ['Second follow-up', { streamingBehavior: 'followUp' }],
      ]);
      expect(adapter.listPendingMessages('queue-session')).toEqual([]);
      expect(first.success).toBe(true);
    });

    it('drains the next follow-up after its predecessor finishes while the queue flush is active', async () => {
      let listener: ((event: { type: string }) => void) | null = null;
      mockSession.subscribe.mockImplementation((callback: (event: { type: string }) => void) => {
        listener = callback;
        return () => {};
      });
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });

      let resolveFirstFollowUp: () => void = () => {};
      mockSession.prompt.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveFirstFollowUp = resolve;
          }),
      );
      adapter.enqueuePendingMessage('queue-session', 'First follow-up');
      adapter.enqueuePendingMessage('queue-session', 'Second follow-up');

      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenLastCalledWith('First follow-up', {
          streamingBehavior: 'followUp',
        });
      });

      // The first queued turn settles while the first queue flush still awaits
      // prompt(). The second item must be picked up once that flush completes.
      listener!({ type: 'agent_end' });
      listener!({ type: 'agent_settled' });
      resolveFirstFollowUp();

      await vi.waitFor(() => {
        expect(mockSession.prompt).toHaveBeenLastCalledWith('Second follow-up', {
          streamingBehavior: 'followUp',
        });
      });
    });

    it('keeps the replacement session when a stopped turn rejects after its queued follow-up starts', async () => {
      let rejectInitialPrompt: (error: Error) => void = () => {};
      mockSession.prompt
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectInitialPrompt = reject;
            }),
        )
        .mockResolvedValueOnce(undefined);

      const initialRun = adapter.startSession('queue-session', 'Start work', {
        sessionMode: 'work',
      });
      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));

      const queued = adapter.enqueuePendingMessage('queue-session', 'Queued follow-up');
      expect(queued.success).toBe(true);

      adapter.stopSession('queue-session');
      await vi.waitFor(() => expect(mockCreateAgentSession).toHaveBeenCalledTimes(2));

      rejectInitialPrompt(new Error('The stopped prompt rejected.'));
      await initialRun;

      expect(adapter.isSessionActive('queue-session')).toBe(true);
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
        refreshSessionArtifacts: vi.fn(),
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

    it('loads a steered turn picks into the running session before sending', async () => {
      await adapter.startSession('steer-skills', 'Start work', {
        sessionMode: 'work',
        skillIds: ['alpha-skill'],
      });
      const queued = adapter.enqueuePendingMessage(
        'steer-skills',
        'Change direction',
        undefined,
        undefined,
        ['beta-skill'],
      );
      expect(queued.success).toBe(true);

      const result = await adapter.steerPendingMessage('steer-skills', queued.item!.id);

      expect(result.success).toBe(true);
      // The steer text goes in raw — no inlined skill body — and the session's
      // resources were reloaded so the model can see the newly attached skill.
      expect(mockSession.reload).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenLastCalledWith('Change direction', {
        streamingBehavior: 'steer',
      });
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
        });
        const listener = mockSession.subscribe.mock.calls.at(-1)![0] as (event: {
          type: string;
          message?: { role: string; content: Array<Record<string, unknown>>; stopReason?: string };
          reason?: string;
          aborted?: boolean;
        }) => void;
        const runId = service.getCurrent('compaction-resume')!.task.activeRunId!;

        listener({ type: 'agent_start' });
        assistantTurn(listener, 'Draft before compaction');
        listener({ type: 'agent_end' });

        // agent_end is not terminal: the SDK compacts and continues on its own,
        // so the run must stay alive and no completion may fire yet.
        expect(service.isRunRunning(runId)).toBe(true);
        expect(completes).toHaveLength(0);

        listener({ type: 'compaction_start', reason: 'threshold' });
        listener({ type: 'compaction_end', reason: 'threshold', aborted: false });
        listener({ type: 'turn_start' });

        // The continuation turn's tool calls still see a running run: the gate
        // must not answer terminateRun the way it does for a completed one.
        const authorization = await service.authorizeToolCall({
          sessionId: 'compaction-resume',
          runId,
          toolCallId: 'post-compaction-call',
          toolName: 'bash',
          toolInput: { command: 'ls -la' },
          approvalMode: WorkbenchApprovalMode.AllowAll,
        });
        expect(authorization.allow).toBe(true);
        expect(authorization.terminateRun).toBeUndefined();

        assistantTurn(listener, 'Final report after compaction');
        listener({ type: 'agent_end' });
        expect(service.isRunRunning(runId)).toBe(true);
        expect(completes).toHaveLength(0);

        listener({ type: 'agent_settled' });
        await vi.waitFor(() => expect(completes).toHaveLength(1));
        expect(service.isRunRunning(runId)).toBe(false);
        expect(errors).toHaveLength(0);
      } finally {
        adapter.stopAllSessions();
        db.close();
      }
    });
  });
});
