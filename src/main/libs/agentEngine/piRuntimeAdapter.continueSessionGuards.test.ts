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

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchExecutionStatus,
} from '../../../shared/workbenchTask';
import { PiExtensionEventType } from './piExtensionTypes';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('continueSession', () => {
    it('records follow-up tool call observations against the current workbench run', async () => {
      const beginRun = vi.fn().mockImplementation((_input: unknown) => ({
        run: { id: `run-${beginRun.mock.calls.length}` },
      }));
      const recordToolCallObserved = vi.fn();
      adapter.setWorkbenchTaskService({
        beginRun,
        recordToolCallObserved,
        recordToolApprovalDecision: vi.fn(),
        recordToolResult: vi.fn(),
        updateRunContext: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('test', 'First', {
        approvalMode: WorkbenchApprovalMode.AllowAll,
      });
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
      const toolCallHandlers: Array<
        (toolCall: {
          toolCallId: string;
          toolName: string;
          input: Record<string, unknown>;
        }) => Promise<unknown>
      > = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === PiExtensionEventType.ToolCall) toolCallHandlers.push(handler);
          },
        });
      }
      const handleToolCall = toolCallHandlers.at(-1);

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

      expect(recordToolCallObserved).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ runId: 'run-1', toolCallId: 'first-call' }),
      );
      expect(recordToolCallObserved).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ runId: 'run-2', toolCallId: 'second-call' }),
      );
    });

    it('passes user prompt verbatim without injecting a harness goal prompt', async () => {
      await adapter.startSession('goal-work', 'Finish the requested task', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenCalledWith('Finish the requested task');

      await adapter.continueSession('goal-work', 'Second goal', {
        sessionMode: 'work',
        goalMode: true,
      });

      expect(mockSession.prompt).toHaveBeenLastCalledWith('Second goal');
    });

    it('runs a plan-mode turn read-only, registers plan_write, and injects plan_mode via before_agent_start', async () => {
      await adapter.startSession('plan-mode', 'Plan the migration', {
        sessionMode: 'work',
        planMode: true,
      });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions.customTools?.map(tool => tool.name)).toContain('plan_write');
      expect(mockSession.prompt).toHaveBeenCalledWith('Plan the migration');

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const beforeAgentHandlers: Array<(event: unknown) => unknown> = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === PiExtensionEventType.BeforeAgentStart) beforeAgentHandlers.push(handler);
          },
        });
      }
      const sections: Record<string, string> = {};
      for (const handler of beforeAgentHandlers) {
        await handler({ prompt: 'Plan the migration', systemPromptOptions: { sections } });
      }
      expect(sections.plan_mode).toContain('## Plan Mode');
      expect(sections.plan_mode).toContain('This turn is read-only planning');
    });

    it('injects plan_mode into systemPromptOptions when a live session plans again without polluting user prompt', async () => {
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

      expect(mockSession.prompt).toHaveBeenLastCalledWith('Plan the next step');
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const beforeAgentHandlers: Array<(event: unknown) => unknown> = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === PiExtensionEventType.BeforeAgentStart) beforeAgentHandlers.push(handler);
          },
        });
      }
      const sections: Record<string, string> = {};
      for (const handler of beforeAgentHandlers) {
        await handler({ prompt: 'Plan the next step', systemPromptOptions: { sections } });
      }
      expect(sections.plan_mode).toContain('## Plan Mode');
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
        approvalMode: WorkbenchApprovalMode.AllowAll,
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

      await adapter.continueSession('plan-guard', 'Now implement it', {
        sessionMode: 'work',
        approvalMode: WorkbenchApprovalMode.AllowAll,
      });
      const allowedEdit = await invokeToolCall({
        toolCallId: 'w2',
        toolName: 'edit',
        input: { path: 'a.txt' },
      });
      expect(allowedEdit).toBeUndefined();
    });

    it('reloads skills in place when a skill is added to Work', async () => {
      const workspaceRoot = createTemporaryWorkspace();
      await adapter.startSession('dynamic-skill', 'First', { sessionMode: 'work', workspaceRoot });

      await adapter.continueSession('dynamic-skill', 'Read package.json', {
        skillIds: ['code-review'],
        sessionMode: 'work',
        workspaceRoot,
      });
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.abort).not.toHaveBeenCalled();
      expect(mockSession.reload).toHaveBeenCalledOnce();
      expect(mockSession.prompt).toHaveBeenLastCalledWith('Read package.json');
      const initialOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      const toolNames = initialOptions.customTools?.map(tool => tool.name);
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
      expect(greetingOptions.customTools?.map(tool => tool.name)).not.toContain('workflow_state');
      expect(mockSession.prompt).toHaveBeenLastCalledWith('你好');
    });

    it('blocks only the denied tool call and lets Pi settle cleanly without tearing down the session', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
      const workspaceRoot = createTemporaryWorkspace();
      const requests: string[] = [];
      adapter.on('permissionRequest', (_sessionId, request) => {
        requests.push(request.requestId);
      });

      try {
        await adapter.startSession('denied-shortcut', 'Create a 10-page presentation', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
          approvalMode: WorkbenchApprovalMode.Ask,
        });
        const listener = mockSession.subscribe.mock.calls.at(-1)![0] as (event: unknown) => void;
        const first = service.getCurrent('denied-shortcut')!;
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
        const authorization = toolCallHandlers.at(-1)!({
          toolCallId: 'write-call',
          toolName: 'write',
          input: { path: 'slides.md', content: 'draft' },
        });
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        adapter.respondToPermission(requests[0], { behavior: 'deny' });
        await expect(authorization).resolves.toMatchObject({ block: true });
        expect(mockSession.abort).not.toHaveBeenCalled();

        // Pi receives the block result and settles the turn normally.
        listener({ type: 'turn_start' });
        listener({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Understood, I will not write that file.' }],
            stopReason: 'stop',
          },
        });
        listener({ type: 'agent_end' });
        listener({ type: 'agent_settled' });

        await adapter.continueSession('denied-shortcut', 'Hello', {
          skillIds: ['presentation-studio'],
          sessionMode: 'work',
          workspaceRoot,
        });

        const current = service.getCurrent('denied-shortcut')!;
        expect(current.task.id).not.toBe(first.task.id);
        expect(current.task.contract.kind).toBe(WorkbenchContractKind.GenericWork);
        expect(service.getDetail(first.task.id)?.task.status).toBe(
          WorkbenchExecutionStatus.Settled,
        );
        expect(mockCreateAgentSession).toHaveBeenCalledOnce();
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
