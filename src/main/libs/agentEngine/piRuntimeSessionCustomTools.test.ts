import { expect, test, vi } from 'vitest';

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import type { HarnessActivationEvent } from '../../../shared/harness';
import { buildPiSessionCustomTools } from './piRuntimeSessionCustomTools';

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
    prompt: 'task',
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
    workflowSkillIds: undefined,
    shortcutKindForContract: null,
    mcpNativeBridge: true,
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
