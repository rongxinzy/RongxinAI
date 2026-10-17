import { expect, test, vi } from 'vitest';

import { CodingEventKind } from '../../shared/codingAgent';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { createService, openCodingRoomDatabase } from './codingRoomServiceTestHarness';

test('creates collaborator lanes in isolated workspaces and runs them independently', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const createIsolatedWorkspace = vi.fn(
    async ({ laneId }: { laneId: string }) => `/isolated/${laneId}`,
  );
  const getWorkspaceBaseline = vi.fn(async () => 'base-commit');
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace,
    getWorkspaceBaseline,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const collaborator = await service.addLane(
    workspaceRoot,
    initial.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const lane = collaborator.lanes.find(candidate => candidate.id !== initial.lanes[0].id)!;

  expect(lane.executionRoot).toBe(`/isolated/${lane.id}`);
  expect(createIsolatedWorkspace).toHaveBeenCalledWith({
    workspaceRoot,
    laneId: lane.id,
    baseline: 'base-commit',
  });
  expect(getWorkspaceBaseline).toHaveBeenCalledTimes(1);
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Review the implementation.' });
  await Promise.resolve();
  expect(startBuiltinSession).toHaveBeenCalledWith({
    sessionId: lane.localSessionId,
    workspaceRoot: lane.executionRoot,
    prompt: 'Review the implementation.',
    thinkingLevel: PiThinkingLevel.Medium,
    permissionMode: WorkbenchApprovalMode.Ask,
  });
});

test('previews and persists an immutable handoff with the source Git baseline', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getWorkspaceBaseline: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'base-commit' : null,
    getWorkspaceDiff: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'diff --git a/file b/file' : null,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const source = created.lanes[0];
  const withCollaborator = await service.addLane(
    workspaceRoot,
    created.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const target = withCollaborator.lanes.find(lane => lane.id !== source.id)!;

  const preview = await service.previewHandoff(workspaceRoot, source.id, target.id);
  const result = await service.handoff(workspaceRoot, source.id, target.id);

  expect(preview).toMatchObject({
    baseline: 'base-commit',
    diff: 'diff --git a/file b/file',
    sourceLaneId: source.id,
  });
  expect(result.events.find(event => event.payload.role === 'handoff')).toMatchObject({
    laneId: target.id,
    kind: CodingEventKind.Message,
    payload: {
      role: 'handoff',
      content: expect.objectContaining({
        baseline: 'base-commit',
        diff: 'diff --git a/file b/file',
      }),
    },
  });
  expect(startBuiltinSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: target.localSessionId,
      workspaceRoot: target.executionRoot,
      prompt: expect.stringContaining('base-commit'),
    }),
  );
});

test('requires an isolated lane and an idle primary writer before applying collaborator changes', async () => {
  const db = openCodingRoomDatabase();
  const applyIsolatedWorkspaceDiff = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getIsolatedWorkspaceDiff: async () => 'diff --git a/file b/file',
    getWorkspaceBaseline: async () => 'base-commit',
    applyIsolatedWorkspaceDiff,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const primaryLane = created.lanes[0];
  const withCollaborator = await service.addLane(
    workspaceRoot,
    created.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const collaborator = withCollaborator.lanes.find(lane => lane.id !== primaryLane.id)!;

  await expect(service.previewLaneChanges(workspaceRoot, primaryLane.id)).rejects.toThrow(
    'isolated',
  );
  await expect(service.previewLaneChanges(workspaceRoot, collaborator.id)).resolves.toEqual({
    laneId: collaborator.id,
    diff: 'diff --git a/file b/file',
  });
  const result = await service.applyLaneChanges(workspaceRoot, collaborator.id);

  expect(applyIsolatedWorkspaceDiff).toHaveBeenCalledWith({
    workspaceRoot,
    isolatedWorkspaceRoot: collaborator.executionRoot,
  });
  expect(result.events.at(-1)).toMatchObject({
    laneId: collaborator.id,
    kind: CodingEventKind.FileChange,
    payload: { action: 'applied_to_workspace' },
  });
});

test('creates deterministic isolated review and verification assignments for a collaboration preset', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getWorkspaceBaseline: async () => 'base-commit',
    getWorkspaceDiff: async () => 'diff --git a/file b/file',
    applyWorkspacePatch: async () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });

  const result = await service.createImplementationReviewVerificationPreset({
    workspaceRoot,
    missionId: initial.missions[0].id,
    reviewerProfileId: 'builtin-zhiyuan-coding',
    verifierProfileId: 'builtin-zhiyuan-coding',
  });

  expect(result.lanes).toHaveLength(3);
  expect(result.assignments.map(assignment => assignment.title)).toEqual([
    initial.missions[0].title,
    `Review: ${initial.missions[0].title}`,
    `Verify: ${initial.missions[0].title}`,
  ]);
  expect(result.assignments.map(assignment => assignment.workflowStage)).toEqual([
    'implementation',
    'review',
    'verification',
  ]);
  expect(result.lanes.slice(1).every(lane => lane.executionRoot.startsWith('/isolated/'))).toBe(
    true,
  );
  expect(startBuiltinSession).not.toHaveBeenCalled();

  await service.prompt(workspaceRoot, { laneId: initial.lanes[0].id, prompt: 'Implement it.' });
  service.recordBuiltinEvent(initial.lanes[0].localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(startBuiltinSession).toHaveBeenCalledTimes(2);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sessionId: result.lanes[1].localSessionId,
      prompt: expect.stringContaining('diff --git'),
    }),
  );
  service.recordBuiltinEvent(result.lanes[1].localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(startBuiltinSession).toHaveBeenCalledTimes(3);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: result.lanes[2].localSessionId }),
  );
});
