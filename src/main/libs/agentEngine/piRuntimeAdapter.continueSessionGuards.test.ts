/**
 * PiRuntimeAdapter unit tests: continuation guards for workbench runs, Goal
 * loops, plan mode, and skill execution.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchTaskStatus,
} from '../../../shared/workbenchTask';
import { PiExtensionEventType } from './piExtensionTypes';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('continueSession', () => {
    it('authorizes follow-up tool calls against the current workbench run', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      const authorizeToolCall = vi.fn().mockResolvedValue({ allow: true });
      adapter.setWorkbenchTaskService({
        beginRun,
        authorizeToolCall,
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('test', 'First');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: {
            on: (
              event: 'tool_call',
              handler: (toolCall: {
                toolCallId: string;
                toolName: string;
                input: Record<string, unknown>;
              }) => Promise<unknown>,
            ) => void;
          }) => void
        >;
      };
      let handleToolCall:
        | ((toolCall: {
            toolCallId: string;
            toolName: string;
            input: Record<string, unknown>;
          }) => Promise<unknown>)
        | undefined;
      loaderOptions.extensionFactories?.[0]({
        on: (_event, handler) => {
          handleToolCall = handler;
        },
      });

      await handleToolCall?.({
        toolCallId: 'first-call',
        toolName: 'write',
        input: { path: 'first.txt' },
      });
      await adapter.continueSession('test', 'Second');
      await handleToolCall?.({
        toolCallId: 'second-call',
        toolName: 'write',
        input: { path: 'second.txt' },
      });

      expect(authorizeToolCall).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ runId: 'run-1', toolCallId: 'first-call' }),
      );
      expect(authorizeToolCall).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ runId: 'run-2', toolCallId: 'second-call' }),
      );
    });

    it('ends the turn with a visible error when the workbench run can no longer execute tools', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      const message = 'The workbench run can no longer continue.';
      const authorizeToolCall = vi
        .fn()
        .mockResolvedValue({ allow: false, reason: message, terminateRun: true });
      adapter.setWorkbenchTaskService({
        beginRun,
        authorizeToolCall,
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);
      const onError = vi.fn();
      adapter.on('error', onError);

      await adapter.startSession('test', 'First');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: {
            on: (
              event: 'tool_call',
              handler: (toolCall: {
                toolCallId: string;
                toolName: string;
                input: Record<string, unknown>;
              }) => Promise<unknown>,
            ) => void;
          }) => void
        >;
      };
      let handleToolCall:
        | ((toolCall: {
            toolCallId: string;
            toolName: string;
            input: Record<string, unknown>;
          }) => Promise<unknown>)
        | undefined;
      loaderOptions.extensionFactories?.[0]({
        on: (_event, handler) => {
          handleToolCall = handler;
        },
      });

      const abortsBeforeCall = mockSession.abort.mock.calls.length;
      const result = await handleToolCall?.({
        toolCallId: 'terminated-call',
        toolName: 'bash',
        input: { command: 'python move_files.py' },
      });

      expect(result).toMatchObject({ block: true });
      // The model must not be asked again, and the user must see why.
      expect(mockSession.abort.mock.calls.length).toBeGreaterThan(abortsBeforeCall);
      expect(onError).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ message: expect.stringContaining('no longer continue') }),
      );
    });

    it('starts the Goal loop only when Work explicitly enables goal mode', async () => {
      await adapter.startSession('goal-work', 'Finish the requested task', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Loop started. Iteration 1. Goal: Finish the requested task'),
      );
    });

    it('restarts a completed Goal loop with the full loop protocol prompt', async () => {
      await adapter.startSession('goal-restart', 'First goal', {
        sessionMode: 'work',
        goalMode: true,
      });
      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { agentLoop: { stop(): void } }>;
        }
      ).activeSessions;
      activeSessions.get('goal-restart')?.agentLoop.stop();

      await adapter.continueSession('goal-restart', 'Second goal', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenLastCalledWith(
        expect.stringContaining('Loop started. Iteration 1. Goal: Second goal'),
      );
    });

    it('runs a plan-mode turn read-only and registers the plan tool', async () => {
      await adapter.startSession('plan-mode', 'Plan the migration', {
        sessionMode: 'work',
        planMode: true,
      });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions.customTools?.map(tool => tool.name)).toContain('plan_write');
      const initialPrompt = mockSession.prompt.mock.calls[0]?.[0] as string;
      expect(initialPrompt).toContain('## Plan Mode');
      expect(initialPrompt).toContain('This turn is read-only planning');
      expect(initialPrompt.endsWith('Plan the migration')).toBe(true);
    });

    it('prepends the plan-mode instruction when a live session plans again', async () => {
      const published: unknown[] = [];
      adapter.on('plan', (_sessionId, plan) => published.push(plan));
      await adapter.startSession('plan-live', 'First task', {
        sessionMode: 'work',
        planTool: true,
      });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (toolCallId: string, params: unknown) => Promise<unknown>;
        }>;
      };
      const planTool = sessionOptions.customTools?.find(tool => tool.name === 'plan_write');
      await planTool?.execute('plan-call', {
        entries: [{ content: 'Extract the auth module', priority: 'high' }],
      });
      expect(published).toEqual([
        {
          entries: [{ content: 'Extract the auth module', status: 'pending', priority: 'high' }],
        },
      ]);

      await adapter.continueSession('plan-live', 'Plan the next step', {
        sessionMode: 'work',
        planMode: true,
      });

      const continuedPrompt = mockSession.prompt.mock.calls[1]?.[0] as string;
      expect(continuedPrompt).toContain('## Plan Mode');
      expect(continuedPrompt.endsWith('Plan the next step')).toBe(true);
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
    });

    it('keeps workspace mutations available outside plan mode', async () => {
      await adapter.startSession('work-mode', 'Ship it', { sessionMode: 'work' });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions.customTools?.map(tool => tool.name) ?? []).not.toContain('plan_write');
    });

    it('refuses workspace-mutating tools only while a plan-mode turn runs', async () => {
      await adapter.startSession('plan-guard', 'Plan the migration', {
        sessionMode: 'work',
        planMode: true,
      });
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const toolCallHandlers: Array<(event: unknown) => unknown> = [];
      const invokeToolCall = async (event: unknown) => {
        const results = await Promise.all(toolCallHandlers.map(handler => handler(event)));
        return results.find(value => value !== undefined);
      };
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event !== PiExtensionEventType.ToolCall) return;
            toolCallHandlers.push(handler);
          },
        });
      }

      const blockedWrite = await invokeToolCall({
        toolCallId: 'w',
        toolName: 'write',
        input: { path: 'a.txt' },
      });
      expect(blockedWrite).toEqual(
        expect.objectContaining({ block: true, reason: expect.stringContaining('Plan mode') }),
      );
      const blockedBash = await invokeToolCall({
        toolCallId: 'b',
        toolName: 'bash',
        input: { command: 'echo unsafe > a.txt' },
      });
      expect(blockedBash).toEqual(
        expect.objectContaining({ block: true, reason: expect.stringContaining('Plan mode') }),
      );
      const allowedRead = await invokeToolCall({
        toolCallId: 'r',
        toolName: 'read',
        input: { path: 'a.txt' },
      });
      expect(allowedRead).toBeUndefined();

      await adapter.continueSession('plan-guard', 'Now implement it', { sessionMode: 'work' });
      const allowedEdit = await invokeToolCall({
        toolCallId: 'w2',
        toolName: 'edit',
        input: { path: 'a.txt' },
      });
      expect(allowedEdit).toBeUndefined();
    });

    it('keeps skill execution controls when a skill is added to Work', async () => {
      const workspaceRoot = createTemporaryWorkspace();
      await adapter.startSession('dynamic-skill', 'First', { sessionMode: 'work', workspaceRoot });

      await adapter.continueSession('dynamic-skill', 'Read package.json', {
        skillIds: ['code-review'],
        sessionMode: 'work',
        workspaceRoot,
      });
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenLastCalledWith('Read package.json');
      const recreatedOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      const toolNames = recreatedOptions.customTools?.map(tool => tool.name);
      expect(toolNames).toContain('run_skill_script');
      expect(toolNames).not.toContain('work_acceptance');
    });

    it('keeps a stable workflow topology before the model skips a greeting', async () => {
      const workspaceRoot = createTemporaryWorkspace();
      await adapter.startSession('production-to-greeting', 'Create a 10-page PPT', {
        skillIds: ['presentation-studio'],
        sessionMode: 'work',
        workspaceRoot,
      });
      const activeSessions = (
        adapter as unknown as {
          activeSessions: Map<string, { agentLoop: { stop(): void } }>;
        }
      ).activeSessions;
      activeSessions.get('production-to-greeting')?.agentLoop.stop();

      await adapter.continueSession('production-to-greeting', '你好', {
        skillIds: ['presentation-studio'],
        sessionMode: 'work',
        workspaceRoot,
      });

      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.abort).not.toHaveBeenCalled();
      const greetingOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(greetingOptions.customTools?.map(tool => tool.name)).toContain('workflow_state');
      expect(mockSession.prompt).toHaveBeenLastCalledWith(
        expect.stringContaining('## Controlled PPT presentation workflow'),
      );
    });

    it('starts a fresh model-decided task after a shortcut approval is denied', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();

      try {
        await adapter.startSession('denied-shortcut', 'Create a 10-page presentation', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
        });
        const first = service.getCurrent('denied-shortcut')!;
        const authorization = service.authorizeToolCall({
          sessionId: 'denied-shortcut',
          runId: first.task.activeRunId!,
          toolCallId: 'write-call',
          toolName: 'write',
          toolInput: { path: 'slides.md', content: 'draft' },
          approvalMode: WorkbenchApprovalMode.Ask,
        });
        const approval = service.getDetail(first.task.id)?.approvals[0];
        service.respondToApproval({ approvalId: approval!.id, approved: false });
        await authorization;

        await adapter.continueSession('denied-shortcut', 'Hello', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
        });

        const current = service.getCurrent('denied-shortcut')!;
        expect(current.task.id).not.toBe(first.task.id);
        expect(current.task.contract.kind).toBe(WorkbenchContractKind.Shortcut);
        expect(service.getDetail(first.task.id)?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
        expect(mockCreateAgentSession).toHaveBeenCalledOnce();
        const greetingOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
          customTools?: Array<{ name: string }>;
        };
        expect(greetingOptions.customTools?.map(tool => tool.name)).not.toContain(
          'production_loop',
        );
      } finally {
        db.close();
      }
    });

    it('should recreate the session when expert tool topology changes', async () => {
      await adapter.startSession('test', 'First', { expertIds: ['expert-a'] });
      await adapter.continueSession('test', 'Second', { expertIds: ['expert-b'] });

      expect(mockSession.abort).toHaveBeenCalledOnce();
      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession.reload).not.toHaveBeenCalled();
    });
  });
});
