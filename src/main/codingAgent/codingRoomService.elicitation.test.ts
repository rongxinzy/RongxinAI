import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  CodingAgentProfileId,
  CodingElicitationStatus,
  CodingLaneStatus,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import {
  createService,
  openCodingRoomDatabase,
  trackTempDirectory,
} from './codingRoomServiceTestHarness';

test('reacquires the workspace writer lease before resuming a builtin elicitation', async () => {
  const db = openCodingRoomDatabase();
  const repository = new CodingRoomRepository(db);
  const respondBuiltinElicitation = vi.fn(() => true);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    respondBuiltinElicitation,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-elicitation-lease-'));
  trackTempDirectory(workspaceRoot);
  const [workspace] = service.createWorkspace({
    name: 'Elicitation lease',
    sourceFolders: [workspaceRoot],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const created = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Implement the requested change.',
  });
  const lane = created.lanes[0];
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-lease',
    question: 'Which API version should I use?',
  });

  expect(repository.getWriterLease(created.room.id, lane.sourceRoot)).toBeNull();

  await service.respondElicitation(workspaceRoot, {
    requestId: 'elicitation-lease',
    answer: 'Use v2.',
  });

  expect(respondBuiltinElicitation).toHaveBeenCalledWith('elicitation-lease', 'Use v2.');
  expect(repository.getWriterLease(created.room.id, lane.sourceRoot)).toBe(lane.id);
});

test('blocks builtin prompts while an elicitation awaits an answer', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/elicitation-prompt-block';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Await clarification',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Start the work.' });
  await Promise.resolve();
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-block',
    question: 'Which endpoint should I change?',
  });
  startBuiltinSession.mockClear();

  await expect(
    service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Just continue anyway.' }),
  ).rejects.toThrow('请先回答或取消当前问题，再发送新消息。');
  expect(startBuiltinSession).not.toHaveBeenCalled();
});

test('cancels a stale question and frees its lane after an application restart', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/elicitation-restart';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Resume after restart',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Start the work.' });
  await Promise.resolve();
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-restart',
    question: 'Which endpoint should I change?',
  });
  expect(service.bootstrap(workspaceRoot).lanes[0].status).toBe(
    CodingLaneStatus.WaitingElicitation,
  );

  // A restart drops the in-process Pi session but keeps the persisted question.
  expect(service.recoverInterruptedState()).toBe(1);

  const recovered = service.bootstrap(workspaceRoot);
  expect(recovered.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(recovered.elicitations).toEqual([
    expect.objectContaining({
      status: CodingElicitationStatus.Cancelled,
      cancelReason: '应用已重启，因此取消了此问题。',
    }),
  ]);
  await expect(
    service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Continue the work.' }),
  ).resolves.toBeTruthy();
});

test('cancels a pending elicitation before stopping its session and blocks deletion while waiting', async () => {
  const db = openCodingRoomDatabase();
  const repository = new CodingRoomRepository(db);
  const cancelBuiltinElicitation = vi.fn(() => true);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    cancelBuiltinElicitation,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-elicitation-cancel-'));
  trackTempDirectory(workspaceRoot);
  const [workspace] = service.createWorkspace({
    name: 'Elicitation cancellation',
    sourceFolders: [workspaceRoot],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const created = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Implement the requested change.',
  });
  const lane = created.lanes[0];
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-cancel',
    question: 'Should I preserve the legacy endpoint?',
  });

  expect(() => service.deleteSession(workspaceRoot, lane.id)).toThrow(
    'Stop the running coding session',
  );
  expect(() => service.deleteWorkspace(workspace.id)).toThrow('Stop all running coding sessions');

  await service.cancel(workspaceRoot, lane.id);

  expect(cancelBuiltinElicitation).toHaveBeenCalledWith(
    'elicitation-cancel',
    '会话已停止，因此取消了此问题。',
  );
  expect(service.bootstrap(workspaceRoot).elicitations).toEqual([
    expect.objectContaining({ status: CodingElicitationStatus.Cancelled }),
  ]);
});
