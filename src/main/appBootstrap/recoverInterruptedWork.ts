import type Database from 'better-sqlite3';
import type { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import type { ActivityService } from '../activity/activityService';
import { CodingElicitationStatus, CodingEventKind } from '../../shared/codingAgent';
import type { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { interruptPendingCompanionReplies } from '../companion/chatPersistence';
import { type CoworkMessageStore, interruptedToolResult } from '../coworkStore/messageStore';
import { t } from '../i18n';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';

export function recoverInterruptedCodingRoom(repository: CodingRoomRepository): number {
  const reason = t('codingAgentElicitationCancelledByRestart');
  const cancelled = repository.cancelPendingElicitations(reason);
  const lanes = repository.recoverInterruptedLanes();
  for (const lane of lanes) {
    repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
      reason: 'application_restart',
    });
  }
  for (const elicitation of cancelled) {
    repository.appendEvent(elicitation.laneId, CodingEventKind.Elicitation, {
      requestId: elicitation.id,
      question: elicitation.question,
      cancelReason: reason,
      status: CodingElicitationStatus.Cancelled,
    });
  }
  return lanes.length;
}

export function recoverInterruptedWork(
  db: Database.Database,
  workbench: Pick<WorkbenchTaskService, 'recoverInterruptedRuns'>,
  scheduled: Pick<SqliteScheduledTaskStore, 'recoverInterruptedRuns'>,
  activity: Pick<ActivityService, 'pruneExpired' | 'recoverInterruptedRuns'>,
  coding: CodingRoomRepository,
  messages?: Pick<CoworkMessageStore, 'listOpenToolUseIds' | 'addMessage'>,
) {
  return db.transaction(() => {
    const companionReplies = interruptPendingCompanionReplies(db);
    const runs = workbench.recoverInterruptedRuns((sessionId, startedAt) => {
      if (!messages) return;
      for (const id of messages.listOpenToolUseIds(sessionId, startedAt)) {
        messages.addMessage(
          sessionId,
          interruptedToolResult(id, t('coworkToolInterruptedByRestart')),
        );
      }
    });
    const scheduledRuns = scheduled.recoverInterruptedRuns();
    const prunedActivity = activity.pruneExpired();
    const activityRuns = activity.recoverInterruptedRuns();
    const codingLanes = recoverInterruptedCodingRoom(coding);
    return { runs, companionReplies, scheduledRuns, activityRuns, prunedActivity, codingLanes };
  })();
}
