import {
  adapter,
  mockDefaultResourceLoader,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import {
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalMode,
} from '../../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { createPiRuntimeResourceLoader } from './piRuntimeResourceLoader';
import { getPiModules } from './piRuntimeSessionState';
import { PiExtensionEventType, type PiExtensionFactory } from './piExtensionTypes';

describe('child tool authorization', () => {
  setupPiRuntimeAdapterSuite();
  test('isolates duplicate provider IDs and records each child effect against its original run', async () => {
    const db = new Database(':memory:');
    initializeWorkbenchTaskSchema(db);
    const service = new WorkbenchTaskService(db);
    adapter.setWorkbenchTaskService(service);
    try {
      await adapter.startSession('parent', 'work', { sessionMode: 'work' });
      const active = adapter.activeSessions.get('parent')!;
      const runId = active.workbenchRunId!;
      const pi = await getPiModules();
      for (const namespace of ['child-1', 'child-2']) {
        await createPiRuntimeResourceLoader(
          adapter,
          pi,
          process.cwd(),
          { ...active.resourceState, nativeToolsOnly: true },
          {
            sessionId: 'parent',
            getRunId: () => runId,
            getApprovalMode: () => WorkbenchApprovalMode.AllowAll,
            toolCallNamespace: namespace,
          },
        );
        const options = mockDefaultResourceLoader.mock.calls.at(-1)![0] as {
          extensionFactories: PiExtensionFactory[];
        };
        const handlers = new Map<string, (event: never) => unknown>();
        options.extensionFactories[0]({
          on: (event: string, handler: (event: never) => unknown) => {
            handlers.set(event, handler);
          },
        } as never);
        const call = {
          toolCallId: 'provider-call-1',
          toolName: 'write',
          input: { path: 'result.md', content: 'verified' },
        };
        expect(await handlers.get(PiExtensionEventType.ToolCall)!(call as never)).toBeUndefined();
        await handlers.get(PiExtensionEventType.ToolResult)!({
          ...call,
          isError: false,
          content: [{ type: 'text', text: 'done' }],
        } as never);
      }
      const approvals = service.getCurrent('parent')!.approvals;
      expect(approvals.map(approval => approval.toolCallId).sort()).toEqual([
        'child-1/provider-call-1',
        'child-2/provider-call-1',
      ]);
      expect(
        approvals.every(
          approval => approval.effectStatus === WorkbenchApprovalEffectStatus.Succeeded,
        ),
      ).toBe(true);
      expect(approvals.every(approval => approval.runId === runId)).toBe(true);
    } finally {
      await adapter.stopAllSessions();
      db.close();
    }
  });
});
