/**
 * PiRuntimeAdapter unit tests: permission responses and session deletion.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  createTestPiRuntime,
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
  WorkbenchApprovalDecision,
  WorkbenchApprovalMode,
  WorkbenchExecutionStatus,
} from '../../../shared/workbenchTask';
import { PiExtensionEventType } from './piExtensionTypes';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import { WorkbenchTaskService as RealWorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('respondToPermission', () => {
    it('should be a no-op for unknown request IDs', () => {
      expect(() => adapter.respondToPermission('unknown', { behavior: 'allow' })).not.toThrow();
      expect(() =>
        adapter.respondToPermission('unknown', { behavior: 'deny', message: 'no' }),
      ).not.toThrow();
    });

    it('blocks only the denied Pi tool call and keeps the Pi turn running', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      const adapter = createTestPiRuntime({ workbenchTaskService: service });
      const requests: string[] = [];
      const interruptions: Array<{
        cause: string;
        taskId: string | null;
        recoverable: boolean;
      }> = [];
      adapter.on('permissionRequest', (_sessionId, request) => requests.push(request.requestId));
      adapter.on('sessionInterrupted', event => interruptions.push(event));

      try {
        await adapter.startSession('denied-workbench', 'Create and validate a release report', {
          sessionMode: 'work',
          workspaceRoot: createTemporaryWorkspace(),
          approvalMode: WorkbenchApprovalMode.Ask,
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
        const authorization = toolCallHandlers.at(-1)!({
          toolCallId: 'write-call',
          toolName: 'write',
          input: { path: 'release.md', content: 'draft' },
        });
        await vi.waitFor(() => expect(requests).toHaveLength(1));

        adapter.respondToPermission(requests[0], {
          behavior: 'deny',
          message: 'Do not write this file.',
        });

        await expect(authorization).resolves.toEqual({
          block: true,
          reason: 'Do not write this file.',
        });
        expect(mockSession.abortBash).not.toHaveBeenCalled();
        expect(mockSession.abort).not.toHaveBeenCalled();
        expect(adapter.isSessionRunning('denied-workbench')).toBe(true);
        const current = service.getCurrent('denied-workbench');
        expect(current?.runs[0].status).toBe(WorkbenchExecutionStatus.Running);
        expect(current?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Denied);
        expect(interruptions).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('appends the AskUserQuestion policy when a custom system prompt is configured', async () => {
      await adapter.startSession('test', 'Hello Pi', { systemPrompt: 'Custom instructions' });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      const appended = loaderOptions.appendSystemPromptOverride(['existing Pi append']);
      expect(appended).toEqual(expect.arrayContaining(['existing Pi append']));
      if (process.platform === 'win32') {
        expect(appended.some(entry => entry.includes('## Bash execution contract'))).toBe(true);
      }
    });

    it('removes AskUserQuestion and adds autonomous guidance for unattended runs', async () => {
      await adapter.startSession('unattended', 'Run the scheduled task', { unattended: true });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions.customTools?.map(tool => tool.name) ?? []).not.toContain(
        'AskUserQuestion',
      );

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      const appended = loaderOptions.appendSystemPromptOverride();
      expect(appended).toContain(PiUnattendedSystemPrompt);
    });

    it('recreates the Pi session when unattended mode changes', async () => {
      await adapter.startSession('mode-switch', 'Start in the foreground');
      await adapter.continueSession('mode-switch', 'Run on schedule', { unattended: true });

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(2);
      const unattendedOptions = mockCreateAgentSession.mock.calls[1]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(unattendedOptions.customTools?.map(tool => tool.name) ?? []).not.toContain(
        'AskUserQuestion',
      );
      const unattendedLoaderOptions = mockDefaultResourceLoader.mock.calls[1]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      expect(unattendedLoaderOptions.appendSystemPromptOverride()).toContain(
        PiUnattendedSystemPrompt,
      );

      await adapter.continueSession('mode-switch', 'Return to the foreground');

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(3);
      const attendedOptions = mockCreateAgentSession.mock.calls[2]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(attendedOptions.customTools?.map(tool => tool.name) ?? []).toContain(
        'AskUserQuestion',
      );
      const attendedLoaderOptions = mockDefaultResourceLoader.mock.calls[2]?.[0] as {
        appendSystemPromptOverride: () => string[];
      };
      const attendedPrompt = attendedLoaderOptions.appendSystemPromptOverride();
      expect(attendedPrompt).not.toContain(PiUnattendedSystemPrompt);
    });

    it('blocks direct Python Skill script calls across bash and powershell tools before execution', async () => {
      await adapter.startSession('bash-guard', 'Inspect the workspace', {
        approvalMode: WorkbenchApprovalMode.AllowAll,
      });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const toolCallHandlers: Array<(event: unknown) => unknown> = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === PiExtensionEventType.ToolCall) toolCallHandlers.push(handler);
          },
        });
      }

      const [bashResults, psResults] = await Promise.all([
        Promise.all(
          toolCallHandlers.map(handler =>
            handler({
              toolCallId: 'bash-guard-call',
              toolName: 'bash',
              input: { command: 'python3 "$SKILLS_ROOT/pdf/scripts/render.py"' },
            }),
          ),
        ),
        Promise.all(
          toolCallHandlers.map(handler =>
            handler({
              toolCallId: 'ps-guard-call',
              toolName: 'powershell',
              input: { command: 'python.exe "$env:SKILLS_ROOT\\pdf\\scripts\\render.py"' },
            }),
          ),
        ),
      ]);
      expect(toolCallHandlers.length).toBeGreaterThan(0);
      expect(bashResults.find(value => value !== undefined)).toEqual(
        expect.objectContaining({
          block: true,
          reason: expect.stringContaining('run_skill_script'),
        }),
      );
      expect(psResults.find(value => value !== undefined)).toEqual(
        expect.objectContaining({
          block: true,
          reason: expect.stringContaining('run_skill_script'),
        }),
      );
    });

    it('resolves a Pi AskUserQuestion tool call with the renderer response', async () => {
      const permissionRequests: Array<{ requestId: string; toolInput: Record<string, unknown> }> =
        [];
      const dismissals: string[] = [];
      adapter.on('permissionRequest', (_sessionId, request) => {
        permissionRequests.push({ requestId: request.requestId, toolInput: request.toolInput });
      });
      adapter.on('permissionDismiss', requestId => dismissals.push(requestId));

      await adapter.startSession('test', 'Ask me something', { confirmationMode: 'modal' });
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (
            toolCallId: string,
            params: Record<string, unknown>,
          ) => Promise<{
            content: Array<{ text: string }>;
          }>;
        }>;
      };
      const askUserTool = sessionOptions.customTools?.find(tool => tool.name === 'AskUserQuestion');
      expect(askUserTool).toBeDefined();

      const toolResult = askUserTool!.execute('tool-call-1', {
        questions: [
          {
            question: 'Continue?',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      });
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(1));
      expect(adapter.getPendingModalPermissionSessionId()).toBe('test');

      adapter.respondToPermission(permissionRequests[0].requestId, {
        behavior: 'allow',
        updatedInput: { answers: { 'Continue?': 'Yes' } },
      });

      await expect(toolResult).resolves.toMatchObject({
        content: [{ text: 'Continue?: Yes' }],
      });
      expect(dismissals).toEqual([permissionRequests[0].requestId]);
      expect(adapter.getPendingModalPermissionSessionId()).toBeUndefined();
    });

    it('keeps AskUserQuestion waits isolated to their owning Pi session', async () => {
      const permissionRequests: Array<{ sessionId: string; requestId: string }> = [];
      adapter.on('permissionRequest', (sessionId, request) => {
        permissionRequests.push({ sessionId, requestId: request.requestId });
      });

      await adapter.startSession('session-a', 'Ask A');
      await adapter.startSession('session-b', 'Ask B');

      const getAskUserTool = (callIndex: number) => {
        const sessionOptions = mockCreateAgentSession.mock.calls[callIndex]?.[0] as {
          customTools?: Array<{
            name: string;
            execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
          }>;
        };
        const tool = sessionOptions.customTools?.find(item => item.name === 'AskUserQuestion');
        expect(tool).toBeDefined();
        return tool!;
      };

      const question = {
        questions: [
          {
            question: 'Continue?',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      };
      let sessionAResolved = false;
      const sessionAResult = getAskUserTool(0)
        .execute('tool-call-a', question)
        .then(result => {
          sessionAResolved = true;
          return result;
        });
      const sessionBResult = getAskUserTool(1).execute('tool-call-b', question);
      await vi.waitFor(() => expect(permissionRequests).toHaveLength(2));

      const sessionBRequest = permissionRequests.find(request => request.sessionId === 'session-b');
      expect(sessionBRequest).toBeDefined();
      adapter.respondToPermission(sessionBRequest!.requestId, {
        behavior: 'allow',
        updatedInput: { answers: { 'Continue?': 'Yes' } },
      });

      await expect(sessionBResult).resolves.toMatchObject({
        content: [{ text: 'Continue?: Yes' }],
      });
      expect(sessionAResolved).toBe(false);

      const sessionARequest = permissionRequests.find(request => request.sessionId === 'session-a');
      expect(sessionARequest).toBeDefined();
      adapter.respondToPermission(sessionARequest!.requestId, { behavior: 'deny' });
      await expect(sessionAResult).resolves.toMatchObject({
        content: [{ text: 'The user denied the operation.' }],
      });
    });
  });

  // ── Cleanup ──

  it('expires and dismisses only the stopped session’s pending approval', async () => {
    const dismissals: string[] = [];
    const requests = new Map<string, string>();
    adapter.on('permissionDismiss', requestId => dismissals.push(requestId));
    adapter.on('permissionRequest', (sessionId, request) => {
      requests.set(sessionId, request.requestId);
    });
    const approve = (sessionId: string) =>
      adapter.authorizeToolCall({
        sessionId,
        runId: null,
        toolCallId: sessionId,
        toolName: 'bash',
        toolInput: { command: 'printf test' },
        approvalMode: WorkbenchApprovalMode.Ask,
      });
    await adapter.startSession('a', 'A', { confirmationMode: 'modal' });
    await adapter.startSession('b', 'B', { confirmationMode: 'modal' });
    await adapter.startSession('channel', 'Channel', { confirmationMode: 'text' });
    const channel = approve('channel');
    const first = approve('a');
    const second = approve('b');
    expect(requests.size).toBe(3);
    expect(adapter.getPendingModalPermissionSessionId()).toBe('a');

    adapter.stopSession('a');

    await expect(first).resolves.toMatchObject({ allow: false });
    expect(dismissals).toEqual([requests.get('a')]);
    expect(adapter.getPendingModalPermissionSessionId()).toBe('b');
    adapter.respondToPermission(requests.get('b')!, { behavior: 'allow' });
    await expect(second).resolves.toEqual({ allow: true });
    expect(dismissals).toEqual([requests.get('a'), requests.get('b')]);
    expect(adapter.getPendingModalPermissionSessionId()).toBeUndefined();
    adapter.respondToPermission(requests.get('channel')!, { behavior: 'deny' });
    await expect(channel).resolves.toMatchObject({ allow: false });
  });

  describe('onSessionDeleted', () => {
    it('should stop the session', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.onSessionDeleted('test');
      expect(adapter.isSessionActive('test')).toBe(false);
    });
  });
});
