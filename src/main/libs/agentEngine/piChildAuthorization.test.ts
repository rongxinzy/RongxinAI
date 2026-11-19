import {
  adapter,
  mockDefaultResourceLoader,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { describe, expect, test } from 'vitest';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { getPiModules } from './piRuntimeSessionState';
import { PiExtensionEventType, type PiExtensionFactory } from './piExtensionTypes';

describe('child tool authorization', () => {
  setupPiRuntimeAdapterSuite();
  test('authorizes concurrent child sessions independently without provider ID namespaces', async () => {
    await adapter.startSession('parent', 'work', {
      sessionMode: 'work',
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    const active = adapter.activeSessions.get('parent')!;
    const pi = await getPiModules();
    const pendingRequests: Array<{ requestId: string; toolName: string }> = [];
    adapter.on('permissionRequest', (_sid, request) => {
      pendingRequests.push({ requestId: request.requestId, toolName: request.toolName });
      adapter.respondToPermission(request.requestId, { behavior: 'allow' });
    });

    try {
      const results = await Promise.all(
        ['child-1', 'child-2'].map(async () => {
          await createPiRuntimeResourceLoader(
            adapter,
            pi,
            process.cwd(),
            { ...active.resourceState, nativeToolsOnly: true },
            {
              sessionId: 'parent',
              getRunId: () => active.workbenchRunId,
              getApprovalMode: () => WorkbenchApprovalMode.Ask,
            },
          );
          const options = mockDefaultResourceLoader.mock.calls.at(-1)![0] as {
            extensionFactories: PiExtensionFactory[];
          };
          const handlers = new Map<string, (event: never) => Promise<unknown>>();
          for (const factory of options.extensionFactories) {
            factory({
              on: (event: string, handler: (event: never) => Promise<unknown>) => {
                handlers.set(event, handler);
              },
            } as never);
          }
          return await handlers.get(PiExtensionEventType.ToolCall)!({
            toolCallId: 'provider-call-1',
            toolName: 'write',
            input: { path: 'result.md', content: 'verified' },
          } as never);
        }),
      );
      expect(results).toEqual([undefined, undefined]);
      expect(pendingRequests).toHaveLength(2);
      expect(new Set(pendingRequests.map(item => item.requestId)).size).toBe(2);
    } finally {
      await adapter.stopAllSessions();
    }
  });

  test('does not consume or inject parent pendingTurnMemory or planMode on subagent before_agent_start while retaining tool approval', async () => {
    await adapter.startSession('parent', 'work', {
      sessionMode: 'work',
      planMode: true,
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    const active = adapter.activeSessions.get('parent')!;
    const stagedMemory = { userPrompt: 'Parent task', context: 'Parent private memory' };
    active.pendingTurnMemory = stagedMemory;
    const pi = await getPiModules();
    const pendingRequests: Array<{ requestId: string; toolName: string }> = [];
    adapter.on('permissionRequest', (_sid, request) => {
      pendingRequests.push({ requestId: request.requestId, toolName: request.toolName });
      adapter.respondToPermission(request.requestId, { behavior: 'allow' });
    });

    try {
      await createPiRuntimeResourceLoader(
        adapter,
        pi,
        process.cwd(),
        { ...active.resourceState, nativeToolsOnly: true },
        {
          sessionId: 'parent',
          isSubagent: true,
          getRunId: () => active.workbenchRunId,
          getApprovalMode: () => WorkbenchApprovalMode.Ask,
        },
      );
      const options = mockDefaultResourceLoader.mock.calls.at(-1)![0] as {
        extensionFactories: PiExtensionFactory[];
      };
      const beforeHandlers: Array<(event: never) => unknown> = [];
      let toolCallHandler: ((event: never) => Promise<unknown>) | undefined;
      for (const factory of options.extensionFactories) {
        factory({
          on: (event: string, handler: (event: never) => unknown) => {
            if (event === PiExtensionEventType.BeforeAgentStart) beforeHandlers.push(handler);
            if (event === PiExtensionEventType.ToolCall) {
              toolCallHandler = handler as (event: never) => Promise<unknown>;
            }
          },
        } as never);
      }

      const sections: Record<string, string> = {};
      const injected: unknown[] = [];
      for (const handler of beforeHandlers) {
        const result = (await handler({
          prompt: 'subtask',
          systemPromptOptions: { sections },
        } as never)) as { message?: unknown } | undefined;
        if (result?.message) injected.push(result.message);
      }

      expect(injected).toEqual([]);
      expect(sections.project_memory).toBeUndefined();
      expect(sections.plan_mode).toBeUndefined();
      expect(active.pendingTurnMemory).toBe(stagedMemory);

      const authResult = await toolCallHandler!({
        toolCallId: 'child-write-1',
        toolName: 'write',
        input: { path: 'child.md', content: 'ok' },
      } as never);
      expect(authResult).toBeUndefined();
      expect(pendingRequests).toHaveLength(1);
    } finally {
      await adapter.stopAllSessions();
    }
  });
});
