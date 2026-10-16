/**
 * PiRuntimeAdapter unit tests: permission responses and session deletion.
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
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { WorkbenchApprovalMode, WorkbenchRunStatus } from '../../../shared/workbenchTask';
import { PiExtensionEventType } from './piExtensionTypes';
import { PiAskUserQuestionSystemPrompt } from './piAskUserQuestion';
import { PiUnattendedSystemPrompt } from './piUnattendedPolicy';
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
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

    it('aborts the active Pi turn when a workbench approval is denied', async () => {
      const db = new Database(':memory:');
      initializeWorkbenchTaskSchema(db);
      const service = new RealWorkbenchTaskService(db);
      adapter.setWorkbenchTaskService(service);
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
        });
        const detail = service.getCurrent('denied-workbench');
        const authorization = service.authorizeToolCall({
          sessionId: 'denied-workbench',
          runId: detail!.task.activeRunId!,
          toolCallId: 'write-call',
          toolName: 'write',
          toolInput: { path: 'release.md', content: 'draft' },
          approvalMode: WorkbenchApprovalMode.Ask,
        });
        await vi.waitFor(() => expect(requests).toHaveLength(1));

        adapter.respondToPermission(requests[0], {
          behavior: 'deny',
          message: 'Do not write this file.',
        });

        await expect(authorization).resolves.toEqual({
          allow: false,
          reason: 'Do not write this file.',
        });
        expect(mockSession.abortBash).toHaveBeenCalledOnce();
        expect(mockSession.abort).toHaveBeenCalledOnce();
        expect(adapter.isSessionRunning('denied-workbench')).toBe(false);
        expect(service.getCurrent('denied-workbench')?.runs[0].status).toBe(
          WorkbenchRunStatus.Paused,
        );
        expect(interruptions).toEqual([
          expect.objectContaining({
            cause: CoworkInterruptionCause.ApprovalDenied,
            taskId: detail!.task.id,
            recoverable: true,
          }),
        ]);
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
      expect(appended).toEqual(
        expect.arrayContaining([
          'existing Pi append',
          PiAskUserQuestionSystemPrompt,
          expect.stringContaining('## Local document reading'),
          expect.stringContaining('## File tool usage'),
          expect.stringContaining('## Large File Writes'),
          DeclareArtifactSystemPrompt,
        ]),
      );
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
      expect(appended).not.toContain(PiAskUserQuestionSystemPrompt);
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
      expect(attendedPrompt).toContain(PiAskUserQuestionSystemPrompt);
      expect(attendedPrompt).not.toContain(PiUnattendedSystemPrompt);
    });

    it('guards Windows Bash calls against cmd and PowerShell syntax', async () => {
      await adapter.startSession('bash-guard', 'Inspect the workspace');

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

      const results = await Promise.all(
        toolCallHandlers.map(handler =>
          handler({
            toolCallId: 'bash-guard-call',
            toolName: 'bash',
            input: { command: 'dir "C:\\workspace" /s' },
          }),
        ),
      );
      const result = results.find(value => value !== undefined);
      expect(toolCallHandlers.length).toBeGreaterThan(0);
      if (process.platform === 'win32') {
        expect(result).toEqual(
          expect.objectContaining({ block: true, reason: expect.stringContaining('Git Bash') }),
        );
      } else {
        expect(result).toBeUndefined();
      }
    });

    it('resolves a Pi AskUserQuestion tool call with the renderer response', async () => {
      const permissionRequests: Array<{ requestId: string; toolInput: Record<string, unknown> }> =
        [];
      const dismissals: string[] = [];
      adapter.on('permissionRequest', (_sessionId, request) => {
        permissionRequests.push({ requestId: request.requestId, toolInput: request.toolInput });
      });
      adapter.on('permissionDismiss', requestId => dismissals.push(requestId));

      await adapter.startSession('test', 'Ask me something');
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

      adapter.respondToPermission(permissionRequests[0].requestId, {
        behavior: 'allow',
        updatedInput: { answers: { 'Continue?': 'Yes' } },
      });

      await expect(toolResult).resolves.toMatchObject({
        content: [{ text: 'Continue?: Yes' }],
      });
      expect(dismissals).toEqual([permissionRequests[0].requestId]);
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

  it('dismisses pending workbench approvals when a session stops', async () => {
    const dismissals: string[] = [];
    adapter.on('permissionDismiss', requestId => dismissals.push(requestId));
    await adapter.startSession('test', 'Hello');
    const approvalSessionMap = (adapter as unknown as { approvalSessionMap: Map<string, string> })
      .approvalSessionMap;
    approvalSessionMap.set('approval-1', 'test');

    adapter.stopSession('test');

    expect(approvalSessionMap.has('approval-1')).toBe(false);
    expect(dismissals).toEqual(['approval-1']);
  });

  describe('onSessionDeleted', () => {
    it('should stop the session', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.onSessionDeleted('test');
      expect(adapter.isSessionActive('test')).toBe(false);
    });
  });
});
