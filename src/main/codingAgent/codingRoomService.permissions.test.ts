import { expect, test, vi } from 'vitest';

import {
  CodingAssignmentStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingWorkflowStage,
} from '../../shared/codingAgent';
import { CoworkInterruptionCause } from '../../shared/cowork/interruption';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { createService, openCodingRoomDatabase } from './codingRoomServiceTestHarness';

test('projects builtin permission requests into the coding room status', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const snapshot = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = snapshot.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.WaitingApproval);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.WaitingApproval);
  expect(updated.assignments[0].status).toBe(CodingAssignmentStatus.WaitingApproval);
});

test('responds to builtin coding permissions through the in-process runtime', async () => {
  const db = openCodingRoomDatabase();
  const respondBuiltinPermission = vi.fn();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    respondBuiltinPermission,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  const result = await service.respondToPermission(workspaceRoot, {
    requestId: 'approval',
    outcome: CodingPermissionOutcome.Selected,
  });

  expect(respondBuiltinPermission).toHaveBeenCalledWith('approval', true);
  expect(result.lanes[0].status).toBe(CodingLaneStatus.Running);
  expect(result.events.at(-1)).toMatchObject({
    kind: CodingEventKind.ToolCall,
    payload: {
      permissionRequestId: 'approval',
      permissionOutcome: CodingPermissionOutcome.Selected,
    },
  });
});

test('pauses a builtin lane when its runtime reports a recoverable interruption', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  service.recordBuiltinInterruption({
    sessionId: lane.localSessionId,
    interruptionId: 'interruption-1',
    cause: CoworkInterruptionCause.ApprovalDenied,
    taskId: 'task',
    recoverable: true,
  });

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.NeedsReview);
  expect(updated.assignments[0].status).toBe(CodingAssignmentStatus.Planned);
  expect(updated.events.at(-1)).toMatchObject({
    kind: CodingEventKind.TurnCancelled,
    payload: { reason: CoworkInterruptionCause.ApprovalDenied },
  });
});

test('cancels a running turn and retains the mission and lane', async () => {
  const db = openCodingRoomDatabase();
  const cancelled: string[] = [];
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async sessionId => {
      cancelled.push(sessionId);
    },
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: 'Implement the change.',
  });
  const updated = await service.cancel(workspaceRoot, lane.id);

  expect(cancelled).toEqual([lane.localSessionId]);
  expect(updated.missions).toHaveLength(1);
  expect(updated.lanes).toHaveLength(1);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.events.at(-1)?.kind).toBe(CodingEventKind.TurnCancelled);
});

test('cancel leaves a lane without an active turn untouched', async () => {
  const db = openCodingRoomDatabase();
  const cancelled: string[] = [];
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async sessionId => {
      cancelled.push(sessionId);
    },
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  const updated = await service.cancel(workspaceRoot, lane.id);

  expect(cancelled).toEqual([]);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.Draft);
  expect(updated.events.filter(event => event.kind === CodingEventKind.TurnCancelled)).toHaveLength(
    0,
  );
});

test('reports a failed automatic collaboration stage without changing assignment state', async () => {
  const db = openCodingRoomDatabase();
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const sourceLane = created.lanes[0];
  const mission = created.missions[0];
  const sourceAssignment = created.assignments[0];
  // A mission created without a Git baseline makes the automatic handoff fail
  // deterministically when the completed turn triggers the next stage.
  const targetLane = repository.createLane(mission.id, 'builtin-zhiyuan-coding', workspaceRoot);
  repository.createAssignment({
    missionId: mission.id,
    laneId: targetLane.id,
    title: 'Verify',
    instructions: 'Verify the implementation.',
    workflowStage: CodingWorkflowStage.Verification,
    previousAssignmentId: sourceAssignment.id,
  });

  service.recordBuiltinEvent(sourceLane.localSessionId, CodingEventKind.TurnComplete, {});
  // The stage failure surfaces through an async rejection handler.
  await new Promise<void>(resolve => setImmediate(resolve));

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes.find(lane => lane.id === sourceLane.id)?.status).toBe(
    CodingLaneStatus.Completed,
  );
  expect(updated.assignments.find(assignment => assignment.laneId === targetLane.id)?.status).toBe(
    CodingAssignmentStatus.Planned,
  );
  const sourceEvents = updated.events.filter(event => event.laneId === sourceLane.id);
  expect(sourceEvents.at(-1)).toMatchObject({
    kind: CodingEventKind.Message,
    payload: { role: 'system', error: expect.stringContaining('frozen baseline') },
  });
});

test('recovers stale running lanes after an application restart without losing the mission', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: 'Implement the change.',
  });

  expect(service.recoverInterruptedState()).toBe(1);
  const recovered = service.bootstrap(workspaceRoot);
  expect(recovered.missions[0].status).toBe(CodingMissionStatus.NeedsReview);
  expect(recovered.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(recovered.events.at(-1)).toMatchObject({
    kind: CodingEventKind.TurnCancelled,
    payload: { reason: 'application_restart' },
  });
});
