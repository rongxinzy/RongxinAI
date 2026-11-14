/**
 * PiRuntimeAdapter unit tests: session continuation and control actions.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockMcpExtensionFactory,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import { describe, expect, it, vi } from 'vitest';
import type { CoworkStore } from '../../coworkStore';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('continueSession', () => {
    it('should fall back to startSession for unknown session', async () => {
      await adapter.continueSession('unknown', 'Hello');
      // Should not throw; falls back to creating new session
      expect(mockSession.subscribe).toHaveBeenCalled();
    });
  });

  describe('builtin control actions', () => {
    const subscribeListener = () =>
      mockSession.subscribe.mock.calls[0]?.[0] as (event: { type: string }) => void;

    it('compacts an idle session and refuses one with a turn in flight', async () => {
      await adapter.startSession('compact-session', 'Start work', { sessionMode: 'work' });
      await expect(adapter.compactSession('compact-session')).rejects.toThrow(/still running/);

      subscribeListener()({ type: 'agent_end' });
      subscribeListener()({ type: 'agent_settled' });

      await expect(adapter.compactSession('compact-session')).resolves.toEqual({
        cancelled: false,
      });
      expect(mockSession.compact).toHaveBeenCalledTimes(1);
    });

    it('runs a queued control action once the current turn settles', async () => {
      await adapter.startSession('queue-session', 'Start work', { sessionMode: 'work' });
      const action = vi.fn(async () => undefined);

      expect(adapter.enqueueControlAction('queue-session', action)).toEqual({ success: true });
      expect(action).not.toHaveBeenCalled();

      subscribeListener()({ type: 'agent_end' });
      subscribeListener()({ type: 'agent_settled' });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('drops queued control actions when the current turn is stopped', async () => {
      await adapter.startSession('stopped-session', 'Start work', { sessionMode: 'work' });
      const action = vi.fn(async () => undefined);
      expect(adapter.enqueueControlAction('stopped-session', action)).toEqual({ success: true });

      adapter.stopSession('stopped-session');

      const queue = (
        adapter as unknown as {
          queue: { queuedControlActions: Map<string, Array<() => Promise<void>>> };
        }
      ).queue;
      expect(queue.queuedControlActions.has('stopped-session')).toBe(false);
      expect(action).not.toHaveBeenCalled();
    });

    it('drops queued control actions when the current turn failed', async () => {
      await adapter.startSession('failed-session', 'Start work', { sessionMode: 'work' });
      const action = vi.fn(async () => undefined);
      expect(adapter.enqueueControlAction('failed-session', action)).toEqual({ success: true });

      const sessions = adapter as unknown as {
        activeSessions: Map<string, { turnFailed: boolean }>;
        queue: {
          queuedControlActions: Map<string, Array<() => Promise<void>>>;
          flushFollowUpQueue(sessionId: string, active: unknown): Promise<void>;
        };
      };
      const active = sessions.activeSessions.get('failed-session');
      if (!active) throw new Error('The test session was not registered.');
      // Pi sets turnFailed when a settled run surfaces a deferred error.
      active.turnFailed = true;

      await sessions.queue.flushFollowUpQueue('failed-session', active);

      expect(sessions.queue.queuedControlActions.has('failed-session')).toBe(false);
      expect(action).not.toHaveBeenCalled();
    });
  });

  describe('continueSession', () => {
    it('should reuse existing session for continuation', async () => {
      await adapter.startSession('test', 'First');
      await adapter.continueSession('test', 'Second');
      // prompt() called twice total (once for start, once for continue)
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('persists only the skills the user attached to the turn, not the execution set', async () => {
      const added: Array<{ content: string; metadata?: Record<string, unknown> }> = [];
      // Only the members this path reads; getSession backs both the transcript
      // lookup and the experts/turn snapshot.
      adapter.setCoworkStore({
        addMessage: (_sessionId: string, message: unknown) => {
          added.push(message as { content: string; metadata?: Record<string, unknown> });
          return message;
        },
        getSession: () => ({ messages: [], experts: [] }),
      } as unknown as CoworkStore);

      await adapter.startSession('attached-skills', 'First', {
        skipInitialUserMessage: true,
        skillIds: ['expert-preset'],
      });
      // Expert/turn execution set kept, nothing attached by the user this turn.
      await adapter.continueSession('attached-skills', 'Second', {
        skillIds: ['expert-preset'],
        attachedSkillIds: [],
      });
      await adapter.continueSession('attached-skills', 'Third', {
        skillIds: ['expert-preset'],
        attachedSkillIds: ['marketing-copy'],
      });
      // A caller with no per-input selection (IM channel turn, scheduled run,
      // workbench resume) records no attachment, so its turn shows no chips even
      // though the session keeps running with its skills.
      await adapter.continueSession('attached-skills', 'Fourth', { skillIds: ['queue-skill'] });

      expect(added.map(message => message.metadata?.skillIds)).toEqual([
        undefined,
        ['marketing-copy'],
        undefined,
      ]);
    });

    it('reloads the session in place after MCP discovery refreshes its tool topology (F13)', async () => {
      adapter.setMcpServerManager({
        toolManifest: [
          {
            server: 'Supabase',
            name: 'list_projects',
            description: 'List projects',
            inputSchema: { type: 'object' },
          },
        ],
        lastEnabledRecords: [],
      } as never);
      await adapter.startSession('test', 'First');

      adapter.refreshMcpTools();
      await adapter.continueSession('test', 'Use Supabase');

      expect(mockSession.abort).not.toHaveBeenCalled();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      expect(mockSession.reload).toHaveBeenCalled();
    });

    it('persists the selected expert on a continuation user message', async () => {
      const addMessage = vi.fn((_sessionId: string, message: Record<string, unknown>) => message);

      await adapter.startSession('test', 'First', { expertIds: ['expert-a'] });
      adapter.setCoworkStore({
        addMessage,
        getSession: vi.fn(() => ({
          experts: [
            {
              expertId: 'expert-a',
              expertName: 'Expert A',
              packageId: 'package-a',
            },
          ],
        })),
        updateSession: vi.fn(),
      } as unknown as CoworkStore);

      await adapter.continueSession('test', 'Second', { expertIds: ['expert-a'] });

      expect(addMessage).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          type: 'user',
          content: 'Second',
          metadata: {
            experts: [
              {
                expertId: 'expert-a',
                expertName: 'Expert A',
                presetId: 'package-a',
              },
            ],
          },
        }),
      );
    });

    it('should reload an active session when its system prompt changes', async () => {
      await adapter.startSession('test', 'First', { systemPrompt: 'You are the original expert.' });
      await adapter.continueSession('test', 'Second', {
        systemPrompt: 'You are the replacement expert.',
      });

      expect(mockSession.reload).toHaveBeenCalledOnce();
      expect(mockSession.abort).not.toHaveBeenCalled();
      expect(mockDefaultResourceLoader).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('should not reload or recreate an active session when resources are unchanged', async () => {
      const options = { systemPrompt: 'Stable prompt', skillIds: ['skill-b', 'skill-a'] };
      await adapter.startSession('test', 'First', options);
      await adapter.continueSession('test', 'Second', options);
      await adapter.continueSession('test', 'Third', options);

      expect(mockSession.reload).not.toHaveBeenCalled();
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenCalledTimes(3);
    });

    it('resolves the newly selected model before continuing a cached session', async () => {
      await adapter.startSession('test', 'First', { modelOverride: 'openai/gpt-5.2' });
      await adapter.continueSession('test', 'Second', { modelOverride: 'zhipu/glm-5.3-flash' });

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      const models = mockCreateAgentSession.mock.calls.map(
        call => (call[0] as { model?: { id?: string } }).model?.id,
      );
      expect(models).toEqual(['openai/gpt-5.2', 'zhipu/glm-5.3-flash']);
      expect(mockSession.abort).toHaveBeenCalledOnce();
      await adapter.continueSession('test', 'Third', { modelOverride: 'zhipu/glm-5.3-flash' });
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
    });

    it('reloads an idle Work session in place when skills change without CAD topology change', async () => {
      await adapter.startSession('test', 'First', { sessionMode: 'work', skillIds: ['skill-a'] });
      await adapter.continueSession('test', 'Second', {
        sessionMode: 'work',
        skillIds: ['skill-b'],
      });

      expect(mockSession.reload).toHaveBeenCalledOnce();
      expect(mockSession.abort).not.toHaveBeenCalled();
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      const loader = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        skillsOverride: (base: { skills: Array<{ id: string }>; diagnostics: unknown[] }) => {
          skills: Array<{ id: string }>;
        };
      };
      expect(
        loader.skillsOverride({
          skills: [{ id: 'skill-a' }, { id: 'skill-b' }],
          diagnostics: [],
        }).skills,
      ).toEqual([{ id: 'skill-b' }]);
    });

    it('recreates a Chat session when its selected skills change', async () => {
      await adapter.startSession('chat-skills', 'First', {
        sessionMode: 'chat',
        skillIds: ['skill-a'],
      });
      await adapter.continueSession('chat-skills', 'Second', {
        sessionMode: 'chat',
        skillIds: ['skill-b'],
      });

      expect(mockSession.reload).not.toHaveBeenCalled();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockSession.dispose).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      const replacementLoader = mockDefaultResourceLoader.mock.calls[1]?.[0] as {
        skillsOverride: (base: { skills: Array<{ id: string }>; diagnostics: unknown[] }) => {
          skills: Array<{ id: string }>;
        };
      };
      expect(
        replacementLoader.skillsOverride({
          skills: [{ id: 'skill-a' }, { id: 'skill-b' }],
          diagnostics: [],
        }).skills,
      ).toEqual([{ id: 'skill-b' }]);
    });

    it('reloads without creating an extra workbench run when Work skillIds change', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      adapter.setWorkbenchTaskService({
        beginRun,
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('test', 'First', { sessionMode: 'work', skillIds: ['skill-a'] });
      await adapter.continueSession('test', 'Second', {
        sessionMode: 'work',
        skillIds: ['skill-b'],
      });

      expect(mockSession.reload).toHaveBeenCalledOnce();
      expect(beginRun).toHaveBeenCalledTimes(2);
    });
  });
});
