/**
 * PiRuntimeAdapter unit tests: session start lifecycle.
 *
 * Tests CoworkRuntime contract compliance using mocked Pi SDK modules. Split
 * from the original piRuntimeAdapter.test.ts; the shared mocks and adapter
 * lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so the Pi
 * SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  createTemporaryWorkspace,
  mockApplyApplicationRuntimeEnv,
  mockCompleteSimple,
  mockCreateAgentSession,
  mockSession,
  mockSessionManagerInMemory,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { AcademicResearchSkillIds } from '../../../shared/skills/constants';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { WorkbenchRunTrigger } from '../../../shared/workbenchTask';
import { PiAgentLoopToolName } from './piAgentLoop';
import { CONVERSATION_HISTORY_TOOL_NAME } from '../../conversationHistory/constants';
import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('startSession', () => {
    it('should create a session and subscribe to events', async () => {
      await adapter.startSession('test', 'Hello Pi');
      await adapter.startSession('test-second', 'Hello again');
      expect(mockApplyApplicationRuntimeEnv).toHaveBeenCalledOnce();
      expect(mockApplyApplicationRuntimeEnv).toHaveBeenCalledWith(process.env);
      expect(mockSession.subscribe).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledWith('Hello Pi');
    });

    it('publishes a started lifecycle event from Pi agent_start', async () => {
      const started = vi.fn();
      adapter.on('started', started);
      await adapter.startSession('started-session', 'Hello Pi');

      const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      listener({ type: 'agent_start' });

      expect(started).toHaveBeenCalledWith('started-session');
    });

    it('uses an in-memory Pi session manager so SQLite remains the only restore source', async () => {
      await adapter.startSession('memory-session', 'Hello Pi');

      expect(mockSessionManagerInMemory).toHaveBeenCalledWith(process.cwd());
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionManager: { cwd: process.cwd() },
        }),
      );
    });

    it('rolls up session memory after a successful agent run', async () => {
      const rollup = vi.fn().mockResolvedValue(null);
      adapter.setSessionSummaryService({ rollup } as never);

      await adapter.startSession('summary-session', 'Remember this', {
        workspaceRoot: '/workspace/project',
      });
      await adapter.patchSession('summary-session', { model: 'openai/gpt-5' });
      const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      listener({ type: 'agent_end' });
      listener({ type: 'agent_settled' });

      expect(rollup).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'summary-session',
          workingDirectory: '/workspace/project',
          complete: expect.any(Function),
        }),
      );
      const complete = rollup.mock.calls[0][0].complete as (
        messages: Array<{ role: string; content: string }>,
      ) => Promise<string>;
      await expect(
        complete([
          { role: 'system', content: 'Extract memory.' },
          { role: 'user', content: 'Conversation payload.' },
        ]),
      ).resolves.toBe('Hello from Pi');
      expect(mockCompleteSimple).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai/gpt-5', provider: 'magpie' }),
        {
          systemPrompt: 'Extract memory.',
          messages: [
            expect.objectContaining({
              role: SessionMemoryCompletionRole.User,
              content: 'Conversation payload.',
              timestamp: expect.any(Number),
            }),
          ],
        },
      );
    });

    it('serializes background memory completions for the same session', async () => {
      let releaseFirst: (() => void) | undefined;
      mockCompleteSimple
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              releaseFirst = () =>
                resolve({
                  content: [{ type: 'text', text: 'First memory' }],
                  stopReason: 'stop',
                });
            }),
        )
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Second memory' }],
          stopReason: 'stop',
        });
      await adapter.startSession('memory-queue', 'Remember this');
      const complete = adapter.getSessionMemoryCompletion('memory-queue');
      expect(complete).not.toBeNull();
      const messages = [
        { role: SessionMemoryCompletionRole.System, content: 'Extract memory.' },
        { role: SessionMemoryCompletionRole.User, content: 'Conversation payload.' },
      ];

      const first = complete!(messages);
      const second = complete!(messages);
      await vi.waitFor(() => expect(mockCompleteSimple).toHaveBeenCalledTimes(1));
      releaseFirst?.();

      await expect(Promise.all([first, second])).resolves.toEqual([
        'First memory',
        'Second memory',
      ]);
      expect(mockCompleteSimple).toHaveBeenCalledTimes(2);
    });

    it('registers raw conversation search as a separate tool', async () => {
      adapter.setConversationHistoryService({ search: vi.fn(() => []) } as never);

      await adapter.startSession('history-session', 'Find the previous decision');
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools: Array<{ name: string }>;
      };

      expect(sessionOptions.customTools.map(tool => tool.name)).toContain(
        CONVERSATION_HISTORY_TOOL_NAME,
      );
    });

    it('initializes a controlled persistent run for academic research', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-academic-runtime-'));
      try {
        await adapter.startSession('academic-session', 'Research reliable agents', {
          workspaceRoot,
          skillIds: [...AcademicResearchSkillIds],
        });
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Academic research run initialized'),
        );
        expect(
          fs.existsSync(
            path.join(
              workspaceRoot,
              '.zhiyuan',
              'research',
              'academic-session',
              'state',
              'progress.json',
            ),
          ),
        ).toBe(true);
        const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools: Array<{ name: string }>;
        };
        expect(sessionOptions.customTools.map(tool => tool.name)).toEqual(
          expect.arrayContaining(['agent_loop', 'research_state', 'subagent']),
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('keeps a sidebar PPT workflow alive when the model ends without a completion signal', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ppt-runtime-'));
      try {
        await adapter.startSession('ppt-session', 'Create a deck', {
          workspaceRoot,
          skillIds: ['presentation-studio'],
        });
        const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools: Array<{ name: string }>;
        };
        expect(sessionOptions.customTools.map(tool => tool.name)).toContain('workflow_state');
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Controlled PPT presentation workflow'),
        );

        const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
          type: string;
        }) => void;
        listener({ type: 'agent_end' });
        await Promise.resolve();

        expect(mockSession.prompt).toHaveBeenLastCalledWith(
          expect.stringContaining('workflow continuation'),
          { streamingBehavior: 'followUp' },
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it('uses native completion for ordinary Work, including resume and expert turns', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();
      try {
        await adapter.startSession('native-work', 'Write and verify a report', {
          sessionMode: 'work',
          workspaceRoot,
          expertIds: ['report-expert'],
        });
        await adapter.continueSession('native-work', 'Check the calculations', {
          sessionMode: 'work',
          workspaceRoot,
        });
        const task = service.getCurrent('native-work')!.task;
        adapter.stopSession('native-work');
        const prepared = service.prepareRun(task.id, WorkbenchRunTrigger.Resume);
        await adapter.continueSession('native-work', 'Continue', {
          sessionMode: 'work',
          workspaceRoot,
          _workbenchRunId: prepared.run.id,
        });
        for (const [options] of mockCreateAgentSession.mock.calls) {
          const names = (options.customTools as Array<{ name: string }>).map(tool => tool.name);
          expect(names).not.toContain('production_loop');
          expect(names).not.toContain(PiAgentLoopToolName);
        }
        const promptCount = mockSession.prompt.mock.calls.length;
        const onComplete = vi.fn();
        adapter.on('complete', onComplete);
        const listener = mockSession.subscribe.mock.calls.at(-1)![0];
        listener({ type: 'agent_end' });
        listener({ type: 'agent_settled' });
        await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
        expect(adapter.isSessionRunning('native-work')).toBe(false);
        expect(mockSession.prompt).toHaveBeenCalledTimes(promptCount);
        expect(service.getCurrent('native-work')!.task.id).toBe(task.id);
        expect(
          db
            .prepare("SELECT name FROM sqlite_master WHERE name = 'workbench_production_loops'")
            .get(),
        ).toBeUndefined();
      } finally {
        await adapter.stopAllSessions();
        db.close();
      }
    });

    it('changes loop tools only when Goal mode is explicitly toggled', async () => {
      await adapter.startSession('goal-toggle', 'First', { sessionMode: 'work' });
      await adapter.continueSession('goal-toggle', 'Keep working', {
        sessionMode: 'work',
        goalMode: true,
      });
      await adapter.continueSession('goal-toggle', 'Answer directly', {
        sessionMode: 'work',
        goalMode: false,
      });
      const toolNames = mockCreateAgentSession.mock.calls.map(([options]) =>
        (options.customTools as Array<{ name: string }>).map(tool => tool.name),
      );
      expect(toolNames).toHaveLength(3);
      expect(toolNames[0]).not.toContain(PiAgentLoopToolName);
      expect(toolNames[1]).toContain(PiAgentLoopToolName);
      expect(toolNames[2]).not.toContain(PiAgentLoopToolName);
    });

    it('records non-sensitive runtime context on initial and reused workbench runs', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('audited-runtime', 'Summarize the report', {
          sessionMode: 'work',
          workspaceRoot,
          skillIds: ['documents'],
        });

        expect(service.getCurrent('audited-runtime')?.runs[0].context).toEqual({
          model: 'qwen-local',
          provider: 'magpie',
          reasoningProfile: 'default',
          workspaceRoot,
          skillIds: ['documents'],
        });

        service.pauseRun('audited-runtime', 'Paused for the next turn.');
        await adapter.continueSession('audited-runtime', 'Summarize the appendix', {
          sessionMode: 'work',
          skillIds: ['documents'],
        });

        const tasks = service.listForSession('audited-runtime');
        expect(tasks).toHaveLength(2);
        for (const task of tasks) {
          expect(service.getDetail(task.id)?.runs[0].context).toEqual({
            model: 'qwen-local',
            provider: 'magpie',
            reasoningProfile: 'default',
            workspaceRoot,
            skillIds: ['documents'],
          });
        }
      } finally {
        db.close();
      }
    });

    it('does not continue after the owning workbench run is paused', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const interruptions: Array<{ cause: string; recoverable: boolean }> = [];
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('paused-production', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
        });
        const listener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
          type: string;
        }) => void;
        service.pauseRun('paused-production', 'Paused for test.');

        listener({ type: 'agent_end' });

        expect(mockSession.prompt).toHaveBeenCalledTimes(1);
        expect(mockSession.abort).toHaveBeenCalledOnce();
        expect(adapter.isSessionRunning('paused-production')).toBe(false);
        expect(interruptions).toEqual([
          expect.objectContaining({
            cause: CoworkInterruptionCause.RuntimePaused,
            recoverable: true,
          }),
        ]);
      } finally {
        db.close();
      }
    });

    it('reactivates a completed academic loop when the same session receives a follow-up', async () => {
      const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-academic-follow-up-'));
      try {
        await adapter.startSession('academic-follow-up', 'Research reliable agents', {
          workspaceRoot,
          skillIds: [...AcademicResearchSkillIds],
        });
        const activeSessions = (
          adapter as unknown as {
            activeSessions: Map<
              string,
              {
                agentLoop: {
                  stop(): void;
                  getState(): { active: boolean };
                };
              }
            >;
          }
        ).activeSessions;
        const active = activeSessions.get('academic-follow-up');
        expect(active).toBeDefined();
        active?.agentLoop.stop();
        mockSession.prompt.mockClear();

        await adapter.continueSession('academic-follow-up', 'Investigate a follow-up.', {
          skillIds: [...AcademicResearchSkillIds],
        });

        expect(active?.agentLoop.getState().active).toBe(true);
        expect(mockSession.prompt).toHaveBeenCalledWith(
          expect.stringContaining('Academic research run initialized'),
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });
});
