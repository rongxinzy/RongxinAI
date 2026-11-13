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
});
