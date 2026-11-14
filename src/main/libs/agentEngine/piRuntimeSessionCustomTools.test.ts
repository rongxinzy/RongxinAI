import { expect, test, vi } from 'vitest';

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import type { HarnessActivationEvent } from '../../../shared/harness';
import { buildPiSessionCustomTools } from './piRuntimeSessionCustomTools';
import * as subagentModule from './piSubagentTool';
import * as resourceLoaderModule from './piRuntimeResourceLoader';

interface SavedCheckpoint {
  metadata: { runId: string; turnId: string };
}

test('a reused summary tool reads the current run and turn for content and metrics', async () => {
  const saved: SavedCheckpoint[] = [];
  const activationRuns: Array<string | null> = [];
  const active = {
    workbenchRunId: 'run-1',
    assistantMessageId: 'message-1',
    artifactRecorder: { recordedWorkVersion: () => 1 },
  };
  const service = {
    saveSessionSummary: vi.fn(async (input: SavedCheckpoint) => {
      saved.push(input);
      return { checkpointId: 'checkpoint', syncState: 'pending' };
    }),
  };
  const host = {
    activeSessions: new Map([['session-1', active]]),
    getProjectMemoryService: () => service,
    getConversationHistoryService: () => null,
    getScheduledTaskService: () => null,
    getStore: () => null,
    getPiAgentsDir: () => '/tmp',
    emit: vi.fn(),
  };
  const recordActivation = (_event: HarnessActivationEvent) => {
    activationRuns.push(active.workbenchRunId);
  };
  const { customTools } = buildPiSessionCustomTools(host as never, {
    pi: {} as never,
    sessionId: 'session-1',
    options: { sessionMode: CoworkSessionMode.Work },
    resourceState: {
      chatMode: false,
      fileToolsEnabled: false,
      unattended: false,
      skillIds: [],
      skillRoots: {},
    } as never,
    resolvedModel: {} as never,
    workspaceRoot: '/work',
    workbenchRunId: 'run-1',
    expertIds: [],
    abortSignal: new AbortController().signal,
    recordActivation,
  });
  const tool = customTools.find(candidate => candidate.name === 'session_summary') as {
    execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
  };

  await expect(
    tool.execute('call-1', { goal: 'first', accomplished: 'first done' }),
  ).resolves.toMatchObject({ details: { status: 'written' } });
  active.workbenchRunId = 'run-2';
  active.assistantMessageId = 'message-2';
  await tool.execute('call-2', { goal: 'second', accomplished: 'second done' });
  active.workbenchRunId = 'run-3';
  await tool.execute('call-3', { skip: true, reason: 'no durable output' });

  expect(saved.map(checkpoint => checkpoint.metadata.runId)).toEqual(['run-1', 'run-2']);
  expect(saved.map(checkpoint => checkpoint.metadata.turnId)).toEqual(['message-1', 'message-2']);
  expect(activationRuns).toEqual(['run-1', 'run-2', 'run-3']);
  expect(active.summaryCheckpointSkipped).toBe('no durable output');
});

test('subagent custom tool bubbles child events to host toolActivityTracker and emits toolActivity', async () => {
  const upserted: unknown[] = [];
  const removed: unknown[] = [];
  const emittedActivities: unknown[] = [];

  const mockTracker = {
    upsert: vi.fn((activity: unknown) => {
      upserted.push(activity);
      return activity;
    }),
    remove: vi.fn((callId: string) => {
      removed.push(callId);
      return { toolCallId: callId };
    }),
  };

  const active = {
    workbenchRunId: 'run-1',
    assistantMessageId: 'message-1',
    artifactRecorder: { recordedWorkVersion: () => 1 },
    toolActivityTracker: mockTracker,
  };

  const host = {
    activeSessions: new Map([['session-1', active]]),
    getProjectMemoryService: () => null,
    getConversationHistoryService: () => null,
    getScheduledTaskService: () => null,
    getStore: () => null,
    getPiAgentsDir: () => '/tmp',
    emit: vi.fn((event: string, sid: string, payload: unknown) => {
      if (event === 'toolActivity') {
        emittedActivities.push({ sid, payload });
      }
    }),
  };

  const subagentSpy = vi.spyOn(subagentModule, 'buildPiSubagentTool');
  const loaderSpy = vi
    .spyOn(resourceLoaderModule, 'createPiRuntimeResourceLoader')
    .mockReturnValue({} as never);

  const { customTools } = buildPiSessionCustomTools(host as never, {
    pi: {} as never,
    sessionId: 'session-1',
    options: { sessionMode: CoworkSessionMode.Work },
    resourceState: {
      chatMode: false,
      fileToolsEnabled: false,
      unattended: false,
      skillIds: [],
      skillRoots: {},
    } as never,
    resolvedModel: {
      model: { provider: 'test', id: 'test-model' },
      modelRuntime: null,
      maxOutputTokens: 4096,
    } as never,
    workspaceRoot: '/work',
    workbenchRunId: 'run-1',
    expertIds: [],
    abortSignal: new AbortController().signal,
    recordActivation: vi.fn(),
  });

  const subagentTool = customTools.find(t => t.name === 'subagent');
  expect(subagentTool).toBeDefined();
  expect(subagentTool!.annotations).toEqual({
    readOnlyHint: true,
    openWorldHint: false,
  });

  expect(subagentSpy).toHaveBeenCalled();
  const subagentDeps = subagentSpy.mock.calls[0][0];
  expect(subagentDeps.onChildToolActivity).toBeDefined();

  // Test child tool start
  subagentDeps.onChildToolActivity!({
    type: 'tool_execution_start',
    toolCallId: 'child-c1',
    parentToolCallId: 'parent-p1',
    toolName: 'read',
    args: { path: 'file.txt' },
  });
  expect(mockTracker.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      toolCallId: 'child-c1',
      parentToolCallId: 'parent-p1',
      toolName: 'read',
    }),
    'running',
  );
  expect(host.emit).toHaveBeenCalledWith('toolActivity', 'session-1', expect.anything());

  // Test child tool update
  subagentDeps.onChildToolActivity!({
    type: 'tool_execution_update',
    toolCallId: 'child-c1',
    parentToolCallId: 'parent-p1',
    toolName: 'read',
    args: { path: 'file.txt' },
    partialResult: 'chunk 1',
  });
  expect(mockTracker.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      toolCallId: 'child-c1',
      parentToolCallId: 'parent-p1',
      partialResult: 'chunk 1',
    }),
    'running',
  );

  // Test child tool end
  subagentDeps.onChildToolActivity!({
    type: 'tool_execution_end',
    toolCallId: 'child-c1',
    parentToolCallId: 'parent-p1',
    toolName: 'read',
  });
  expect(mockTracker.remove).toHaveBeenCalledWith('child-c1');

  // Verify resource loader for subagents unlocks MCP & codemode (nativeToolsOnly: false)
  subagentDeps.createPiResourceLoader('/work', 'system prompt', 4096);
  expect(loaderSpy).toHaveBeenCalledWith(
    host,
    expect.anything(),
    '/work',
    expect.objectContaining({
      nativeToolsOnly: false,
    }),
    expect.anything(),
    undefined,
  );
});
