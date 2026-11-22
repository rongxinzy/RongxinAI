import { expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingWorkflowStage,
  type CodingRoomSnapshot,
} from '../../shared/codingAgent';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { createService, openCodingRoomDatabase } from './codingRoomServiceTestHarness';

function addHistoricalLane(
  repository: CodingRoomRepository,
  snapshot: CodingRoomSnapshot,
  id: string,
  stage?: CodingWorkflowStage,
  previousAssignmentId?: string,
) {
  const mission = snapshot.missions[0];
  const initialLane = snapshot.lanes[0];
  const lane = repository.createLane(
    mission.id,
    initialLane.profileId,
    initialLane.sourceRoot,
    `/isolated/${id}`,
    id,
  );
  const assignment = repository.createAssignment({
    missionId: mission.id,
    laneId: lane.id,
    title: mission.title,
    instructions: 'Continue the existing assignment.',
    workflowStage: stage,
    previousAssignmentId,
  });
  return { lane, assignment };
}

test('runs an existing collaborator lane in its isolated workspace', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const getWorkspaceBaseline = vi.fn(async () => 'base-commit');
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    getWorkspaceBaseline,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.seedSession({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const { lane } = addHistoricalLane(repository, initial, 'existing-review');
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

test('persists and delivers an immutable handoff with the source Git baseline', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    getWorkspaceBaseline: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'base-commit' : null,
    getWorkspaceDiff: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'diff --git a/file b/file' : null,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.seedSession({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const source = created.lanes[0];
  const { lane: target } = addHistoricalLane(repository, created, 'existing-target');

  const result = await service.handoff(workspaceRoot, source.id, target.id);
  expect(result.events.find(event => event.payload.role === 'handoff')).toMatchObject({
    laneId: target.id,
    kind: CodingEventKind.Message,
    payload: {
      role: 'handoff',
      content: expect.objectContaining({
        sourceLaneId: source.id,
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
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    getIsolatedWorkspaceDiff: async () => 'diff --git a/file b/file',
    getWorkspaceBaseline: async () => 'base-commit',
    applyIsolatedWorkspaceDiff,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.seedSession({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const primaryLane = created.lanes[0];
  const { lane: collaborator } = addHistoricalLane(repository, created, 'existing-patch');

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

test('advances existing review and verification assignments in order', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    getWorkspaceBaseline: async () => 'base-commit',
    getWorkspaceDiff: async () => 'diff --git a/file b/file',
    applyWorkspacePatch: async () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.seedSession({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });

  const review = addHistoricalLane(
    repository,
    initial,
    'existing-review',
    CodingWorkflowStage.Review,
    initial.assignments[0].id,
  );
  const verification = addHistoricalLane(
    repository,
    initial,
    'existing-verify',
    CodingWorkflowStage.Verification,
    review.assignment.id,
  );
  expect(startBuiltinSession).not.toHaveBeenCalled();

  await service.prompt(workspaceRoot, { laneId: initial.lanes[0].id, prompt: 'Implement it.' });
  service.recordBuiltinEvent(initial.lanes[0].localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(startBuiltinSession).toHaveBeenCalledTimes(2);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sessionId: review.lane.localSessionId,
      prompt: expect.stringContaining('diff --git'),
    }),
  );
  service.recordBuiltinEvent(review.lane.localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(startBuiltinSession).toHaveBeenCalledTimes(3);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: verification.lane.localSessionId }),
  );
});
