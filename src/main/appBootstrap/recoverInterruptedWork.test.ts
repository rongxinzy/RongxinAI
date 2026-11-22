import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from '../../scheduledTask/constants';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import { ActivityService } from '../activity/activityService';
import { initializeActivitySchema } from '../activity/schema';
import { initializeScheduledTaskSchema } from '../../scheduledTask/schema';
import { CompanionRequestState } from '../../shared/companion/constants';
import {
  CodingAgentProfileId,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
} from '../../shared/codingAgent';
import { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { initializeCodingAgentSchema } from '../codingAgent/schema';
import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchExecutionStatus,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { initializeCompanionSchema } from '../companion/schema';
import { CoworkMessageStore } from '../coworkStore/messageStore';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { recoverInterruptedWork } from './recoverInterruptedWork';

test('reopening the database recovers Work, companion runs and replies, and external runs atomically', () => {
  const root = mkdtempSync(join(tmpdir(), 'work-recovery-'));
  const path = join(root, 'work.sqlite');
  let db = new Database(path);
  try {
    db.exec(`CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER);
      INSERT INTO cowork_sessions VALUES ('work', 'running', 1), ('companion', 'idle', 1);
      CREATE TABLE cowork_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
        content TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL, sequence INTEGER);`);
    initializeWorkbenchTaskSchema(db);
    initializeCompanionSchema(db);
    initializeScheduledTaskSchema(db);
    initializeActivitySchema(db);
    initializeCodingAgentSchema(db);
    const coding = new CodingRoomRepository(db);
    const room = coding.getOrCreateRoom(root);
    const mission = coding.createMission(room.id, 'Interrupted coding');
    const lane = coding.createLane(mission.id, CodingAgentProfileId.Builtin, root);
    coding.updateLaneStatus(lane.id, CodingLaneStatus.WaitingElicitation);
    coding.updateMissionStatus(mission.id, CodingMissionStatus.WaitingElicitation);
    coding.createElicitation(lane.id, 'Which part should change?');
    coding.acquireWriterLease(room.id, root, lane.id);
    db.prepare(`INSERT INTO companion_chat_turns (pet_id, request_id, state, input)
      VALUES ('pet', 'unfinished', ?, 'Wait for this reply')`).run(CompanionRequestState.Accepted);
    const before = new WorkbenchTaskService(db);
    const work = before.beginRun({ sessionId: 'work', goal: 'Work' });
    const insertMessage = db.prepare(
      `INSERT INTO cowork_messages VALUES (?, 'work', ?, '', ?, ?, ?)`,
    );
    const startedAt = work.run.startedAt!;
    insertMessage.run('older-call', 'tool_use', '{"toolUseId":"before-run"}', startedAt - 1, 1);
    insertMessage.run('call', 'tool_use', '{"toolUseId":"executing-call"}', startedAt, 2);
    insertMessage.run('completed-call', 'tool_use', '{"toolUseId":"finished"}', startedAt, 3);
    insertMessage.run('result', 'tool_result', '{"toolUseId":"finished"}', startedAt, 4);
    const external = before.beginRun({ sessionId: 'external', goal: 'External coding' });
    const completed = before.beginRun({ sessionId: 'completed', goal: 'Already finished' });
    before.settleObservedRun({ sessionId: 'completed', runId: completed.run.id });
    const finishedHistory = before.getDetail(completed.task.id);
    const companion = before.repository.createTask('companion', 'Queued companion task', {
      kind: WorkbenchContractKind.GenericWork,
    });
    const queued = before.repository.createRun(companion.id, WorkbenchRunTrigger.Message);
    expect(before.repository.getTask(companion.id)?.activeRunId).toBe(queued.id);
    before.recordToolCallObserved({
      runId: work.run.id,
      approvalId: 'approval-id',
      toolCallId: 'call-id',
      toolName: 'write',
      toolInput: { path: 'report.txt' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'work-approval',
      autoApproved: false,
    });
    before.recordToolCallObserved({
      runId: work.run.id,
      approvalId: 'executing-approval',
      toolCallId: 'executing-call',
      toolName: 'write',
      toolInput: { path: 'draft.txt' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'executing-effect',
      autoApproved: true,
    });
    const cron = new SqliteScheduledTaskStore(db);
    const schedule = cron.create({
      name: 'Morning report',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
      sessionTarget: SessionTarget.Isolated,
      wakeMode: WakeMode.NextHeartbeat,
      payload: { kind: PayloadKind.AgentTurn, message: 'Report' },
      delivery: { mode: DeliveryMode.None },
    });
    const claim = (scheduledAt: string) =>
      cron.claimTrigger({
        taskId: schedule.id,
        scheduleVersion: schedule.scheduleVersion!,
        scheduledAt,
      })!;
    const completedCron = cron.finishRun(claim('2026-08-10T01:00:00.000Z').id, {
      status: TaskStatus.Success,
    });
    const interruptedCron = claim('2026-08-11T01:00:00.000Z');
    // Older profiles can contain both canonical runs and legacy Activity snapshots.
    const insertLegacyActivity = db.prepare(`INSERT INTO zhiyuan_activity_runs
      (id, source, status, task_name, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const interruptedAt = Date.parse(interruptedCron.startedAt);
    insertLegacyActivity.run(
      interruptedCron.id,
      ActivitySource.ScheduledTask,
      ActivityStatus.Running,
      schedule.name,
      interruptedAt,
      interruptedAt,
    );
    insertLegacyActivity.run(
      'expired',
      ActivitySource.ScheduledTask,
      ActivityStatus.Completed,
      null,
      1,
      1,
    );
    db.close();

    db = new Database(path);
    const workbench = new WorkbenchTaskService(db);
    const reopenedCron = new SqliteScheduledTaskStore(db);
    const reopenedActivity = new ActivityService(db);
    const reopenedCoding = new CodingRoomRepository(db);
    const messages = new CoworkMessageStore(db);
    const recover = () =>
      recoverInterruptedWork(
        db,
        workbench,
        reopenedCron,
        reopenedActivity,
        reopenedCoding,
        messages,
      );
    const toolResults = () =>
      messages
        .readSessionMessages('work', null)
        .messages.filter(message => message.type === 'tool_result');
    const cronRun = () =>
      reopenedCron.listRuns(schedule.id).find(run => run.id === interruptedCron.id);
    const cronProjection = () => reopenedActivity.list().find(run => run.id === interruptedCron.id);
    const status = () =>
      db.prepare("SELECT status, updated_at FROM cowork_sessions WHERE id = 'work'").get();
    const reply = () => db.prepare('SELECT state FROM companion_chat_turns').get();

    db.exec(`CREATE TRIGGER fixture_block_recovery BEFORE UPDATE OF status ON workbench_runs
      WHEN NEW.status = '${WorkbenchExecutionStatus.Cancelled}'
      BEGIN SELECT RAISE(ABORT, 'fixture terminal write failure'); END;`);
    expect(recover).toThrow('fixture terminal write failure');
    expect(status()).toEqual({ status: 'running', updated_at: 1 });
    expect(reply()).toEqual({ state: CompanionRequestState.Accepted });
    expect(workbench.getDetail(work.task.id)?.runs[0].status).toBe(
      WorkbenchExecutionStatus.Running,
    );
    expect(workbench.repository.getApproval('approval-id')?.decision).toBe(
      WorkbenchApprovalDecision.Pending,
    );
    expect(workbench.repository.getApproval('executing-approval')?.effectStatus).toBe(
      WorkbenchApprovalEffectStatus.Executing,
    );
    db.exec('DROP TRIGGER fixture_block_recovery');

    db.exec(`CREATE TRIGGER fixture_block_cron BEFORE UPDATE ON zhiyuan_scheduled_task_runs
      BEGIN SELECT RAISE(ABORT, 'fixture Cron failure'); END;`);
    expect(recover).toThrow('fixture Cron failure');
    expect(status()).toEqual({ status: 'running', updated_at: 1 });
    expect(reply()).toEqual({ state: CompanionRequestState.Accepted });
    expect(workbench.getDetail(work.task.id)?.runs[0].status).toBe(
      WorkbenchExecutionStatus.Running,
    );
    expect(cronRun()).toEqual(interruptedCron);
    expect(toolResults()).toHaveLength(1);
    expect(cronProjection()?.status).toBe(ActivityStatus.Running);
    expect(reopenedActivity.list().map(run => run.id)).toContain('expired');
    expect(reopenedCron.get(schedule.id)?.state.runningAtMs).toBe(
      Date.parse(interruptedCron.startedAt),
    );
    db.exec(`DROP TRIGGER fixture_block_cron;
      CREATE TRIGGER fixture_block_snapshot BEFORE UPDATE ON zhiyuan_activity_runs
      WHEN OLD.id = '${interruptedCron.id}'
      BEGIN SELECT RAISE(ABORT, 'unexpected Cron snapshot write'); END;`);

    db.exec(`CREATE TRIGGER fixture_block_lane_event BEFORE INSERT ON coding_events
      WHEN NEW.kind = '${CodingEventKind.Elicitation}'
      BEGIN SELECT RAISE(ABORT, 'fixture Coding event failure'); END;`);
    expect(recover).toThrow('fixture Coding event failure');
    expect(workbench.getDetail(work.task.id)?.runs[0].status).toBe(
      WorkbenchExecutionStatus.Running,
    );
    expect(reply()).toEqual({ state: CompanionRequestState.Accepted });
    expect(cronRun()).toEqual(interruptedCron);
    expect(reopenedCoding.listLanes([mission.id])[0].status).toBe(
      CodingLaneStatus.WaitingElicitation,
    );
    expect(reopenedCoding.listElicitations([lane.id])[0].status).toBe(
      CodingElicitationStatus.Pending,
    );
    expect(reopenedCoding.getWriterLease(room.id, root)).toBe(lane.id);
    expect(reopenedCoding.listEvents([lane.id])).toEqual([]);
    db.exec('DROP TRIGGER fixture_block_lane_event');

    expect(recover()).toEqual({
      runs: 3,
      companionReplies: 1,
      scheduledRuns: 1,
      activityRuns: 0,
      prunedActivity: 1,
      codingLanes: 1,
    });
    const recoveredCron = cronRun();
    expect(recoveredCron).toMatchObject({
      id: interruptedCron.id,
      status: TaskStatus.Error,
      error: 'Scheduler interrupted before Pi completion',
    });
    expect(cronProjection()).toMatchObject({
      status: ActivityStatus.Failed,
      errorMessage: recoveredCron?.error,
      taskName: schedule.name,
      updatedAt: Date.parse(recoveredCron!.finishedAt!),
    });
    expect(reopenedCron.get(schedule.id)?.state).toMatchObject({
      runningAtMs: null,
      consecutiveErrors: 1,
      lastStatus: TaskStatus.Error,
    });
    expect(reopenedCron.listRuns(schedule.id)).toContainEqual(completedCron);
    expect(reopenedActivity.list().find(run => run.id === completedCron.id)).toMatchObject({
      status: ActivityStatus.Completed,
      id: completedCron.id,
    });
    expect(status()).toEqual({ status: 'running', updated_at: expect.any(Number) });
    expect(toolResults()).toHaveLength(2);
    expect(toolResults()[1].metadata).toMatchObject({
      toolUseId: 'executing-call',
      error: 'interrupted',
      isError: true,
      isFinal: true,
    });
    expect(reply()).toEqual({ state: CompanionRequestState.Unanswered });
    for (const taskId of [work.task.id, companion.id, external.task.id]) {
      const detail = workbench.getDetail(taskId);
      expect(detail?.task).toMatchObject({
        status: WorkbenchExecutionStatus.Cancelled,
        activeRunId: null,
      });
      expect(detail?.runs[0]).toMatchObject({
        status: WorkbenchExecutionStatus.Cancelled,
        failure: { reason: 'application_restart' },
      });
      expect(
        detail?.events.filter(event => event.type === WorkbenchRunEventType.RunCancelled),
      ).toHaveLength(1);
    }
    const interrupted = workbench.getDetail(work.task.id);
    expect(workbench.repository.getApproval('approval-id')).toMatchObject({
      decision: WorkbenchApprovalDecision.Expired,
      decisionSource: WorkbenchApprovalDecisionSource.Recovery,
    });
    expect(workbench.repository.getApproval('executing-approval')).toMatchObject({
      decision: WorkbenchApprovalDecision.Approved,
      decisionSource: WorkbenchApprovalDecisionSource.Policy,
      effectStatus: WorkbenchApprovalEffectStatus.NeedsReview,
    });
    expect(workbench.getDetail(completed.task.id)).toEqual(finishedHistory);
    expect(recover()).toEqual({
      runs: 0,
      companionReplies: 0,
      scheduledRuns: 0,
      activityRuns: 0,
      prunedActivity: 0,
      codingLanes: 0,
    });
    expect(toolResults()).toHaveLength(2);
    expect(reopenedCoding.listLanes([mission.id])[0].status).toBe(CodingLaneStatus.Idle);
    expect(reopenedCoding.listMissions(room.id)[0].status).toBe(CodingMissionStatus.NeedsReview);
    expect(reopenedCoding.listElicitations([lane.id])[0].status).toBe(
      CodingElicitationStatus.Cancelled,
    );
    expect(reopenedCoding.getWriterLease(room.id, root)).toBeNull();
    expect(reopenedCoding.listEvents([lane.id]).map(event => event.kind)).toEqual([
      CodingEventKind.TurnCancelled,
      CodingEventKind.Elicitation,
    ]);
    expect(cronRun()).toEqual(recoveredCron);
    expect(reopenedCron.get(schedule.id)?.state.consecutiveErrors).toBe(1);
    expect(workbench.getDetail(work.task.id)).toEqual(interrupted);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
