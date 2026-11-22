import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';

import {
  ActivityErrorCode,
  ActivityIpc,
  ActivityRetention,
  ActivitySource,
  ActivityStatus,
} from '../../shared/activity/constants';
import { shouldAcceptActivityUpdate } from '../../shared/activity/ordering';
import type { ActivityRun } from '../../shared/activity/types';
import { TaskStatus } from '../../scheduledTask/constants';
import type { ScheduledTaskRun } from '../../scheduledTask/types';

type ChannelRunUpdate = Omit<ActivityRun, 'source' | 'taskName' | 'startedAt' | 'updatedAt'> & {
  startedAt?: number;
  updatedAt?: number;
};

type ActivityRow = {
  id: string;
  source: ActivityRun['source'];
  status: ActivityRun['status'];
  started_at: number;
  updated_at: number;
  session_id: string | null;
  platform: string | null;
  conversation_id: string | null;
  task_name: string | null;
  reply_preview: string | null;
  error_message: string | null;
};

const CRON_ACTIVITY_STATUS = {
  [TaskStatus.Running]: ActivityStatus.Running,
  [TaskStatus.Success]: ActivityStatus.Completed,
  [TaskStatus.Skipped]: ActivityStatus.Completed,
  [TaskStatus.Error]: ActivityStatus.Failed,
} as const;

const CRON_ACTIVITY_PROJECTION = `
  SELECT r.id, '${ActivitySource.ScheduledTask}' AS source,
    CASE r.status
      ${Object.entries(CRON_ACTIVITY_STATUS)
        .map(([run, activity]) => `WHEN '${run}' THEN '${activity}'`)
        .join('\n      ')}
    END AS status,
    ROUND(unixepoch(r.started_at, 'subsec') * 1000) AS started_at,
    ROUND(unixepoch(MAX(r.started_at, COALESCE(r.finished_at, r.started_at)), 'subsec') * 1000)
      AS updated_at,
    r.session_id,
    a.platform, a.conversation_id,
    COALESCE(r.task_name, a.task_name) AS task_name,
    COALESCE(r.reply_preview, a.reply_preview) AS reply_preview,
    r.error AS error_message
  FROM zhiyuan_scheduled_task_runs r
  LEFT JOIN zhiyuan_activity_runs a
    ON r.task_name IS NULL AND a.id = r.id AND a.source = '${ActivitySource.ScheduledTask}'
`;

const HAS_CANONICAL_CRON_RUN = `a.source = '${ActivitySource.ScheduledTask}'
  AND EXISTS (SELECT 1 FROM zhiyuan_scheduled_task_runs r WHERE r.id = a.id)`;

const ACTIVITY_PROJECTION = `
  ${CRON_ACTIVITY_PROJECTION}
  WHERE MAX(r.started_at, COALESCE(r.finished_at, r.started_at)) >= ?
  UNION ALL
  SELECT a.id, a.source, a.status, a.started_at, a.updated_at, a.session_id, a.platform,
    a.conversation_id, a.task_name, a.reply_preview, a.error_message
  FROM zhiyuan_activity_runs a WHERE NOT (${HAS_CANONICAL_CRON_RUN})
  ORDER BY updated_at DESC LIMIT ?
`;

export class ActivityService {
  constructor(private readonly db: Database.Database) {}

  list(limit = 100, nowMs = Date.now()): ActivityRun[] {
    const cutoff = new Date(nowMs - ActivityRetention.Milliseconds).toISOString();
    return (this.db.prepare(ACTIVITY_PROJECTION).all(cutoff, limit) as ActivityRow[]).map(row =>
      this.fromRow(row),
    );
  }

  /** Removes display-only snapshots that are outside the documented retention window. */
  pruneExpired(nowMs = Date.now()): number {
    const cutoffMs = nowMs - ActivityRetention.Milliseconds;
    return this.db
      .prepare(`DELETE FROM zhiyuan_activity_runs AS a
        WHERE COALESCE((
          SELECT ROUND(unixepoch(MAX(r.started_at, COALESCE(r.finished_at, r.started_at)), 'subsec') * 1000)
          FROM zhiyuan_scheduled_task_runs r WHERE r.id = a.id AND a.source = ?
        ), a.updated_at) < ?`)
      .run(ActivitySource.ScheduledTask, cutoffMs).changes;
  }

  /** Close stale snapshots with no canonical Cron run, preserving feed order. */
  recoverInterruptedRuns(): number {
    return this.db
      .prepare(
        `UPDATE zhiyuan_activity_runs AS a
         SET status = ?, error_message = COALESCE(error_message, ?)
         WHERE status = ? AND NOT (${HAS_CANONICAL_CRON_RUN})`,
      )
      .run(ActivityStatus.Failed, ActivityErrorCode.Interrupted, ActivityStatus.Running).changes;
  }

  private writeChannelRun(update: ChannelRunUpdate): ActivityRun | null {
    const existing = this.db
      .prepare(`SELECT id, source, status, started_at, updated_at, session_id, platform,
        conversation_id, task_name, reply_preview, error_message
        FROM zhiyuan_activity_runs WHERE id = ?`)
      .get(update.id) as ActivityRow | undefined;
    if (existing && existing.source !== ActivitySource.Channel) return null;
    const now = update.updatedAt ?? Date.now();
    if (existing) {
      const current = this.fromRow(existing);
      const candidate = {
        ...current,
        ...update,
        startedAt: update.startedAt ?? current.startedAt,
        updatedAt: now,
      };
      if (!shouldAcceptActivityUpdate(current, candidate)) return current;
    }
    const run: ActivityRun = {
      id: update.id,
      source: ActivitySource.Channel,
      status: update.status,
      startedAt: update.startedAt ?? existing?.started_at ?? now,
      updatedAt: now,
      sessionId: update.sessionId ?? existing?.session_id ?? undefined,
      platform: update.platform ?? existing?.platform ?? undefined,
      conversationId: update.conversationId ?? existing?.conversation_id ?? undefined,
      replyPreview: update.replyPreview ?? existing?.reply_preview ?? undefined,
      errorMessage: update.errorMessage ?? existing?.error_message ?? undefined,
    };
    this.db
      .prepare(`INSERT INTO zhiyuan_activity_runs (
      id, source, status, started_at, updated_at, session_id, platform, conversation_id, reply_preview, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, started_at=excluded.started_at,
      updated_at=excluded.updated_at, session_id=excluded.session_id, platform=excluded.platform,
      conversation_id=excluded.conversation_id,
      reply_preview=excluded.reply_preview, error_message=excluded.error_message`)
      .run(
        run.id,
        run.source,
        run.status,
        run.startedAt,
        run.updatedAt,
        run.sessionId ?? null,
        run.platform ?? null,
        run.conversationId ?? null,
        run.replyPreview ?? null,
        run.errorMessage ?? null,
      );
    this.broadcast(run);
    return run;
  }

  publishScheduledRun(run: ScheduledTaskRun): void {
    const row = this.db.prepare(`${CRON_ACTIVITY_PROJECTION} WHERE r.id = ?`).get(run.id) as
      | ActivityRow
      | undefined;
    if (row) this.broadcast(this.fromRow(row));
  }

  recordChannelRun(update: ChannelRunUpdate): ActivityRun | null {
    try {
      return this.writeChannelRun(update);
    } catch (error) {
      console.error('[Activity] failed to record Channel run:', error);
      return null;
    }
  }

  private broadcast(run: ActivityRun): void {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send(ActivityIpc.Updated, run);
  }

  private fromRow(row: ActivityRow): ActivityRun {
    return {
      id: row.id,
      source: row.source,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      sessionId: row.session_id ?? undefined,
      platform: row.platform ?? undefined,
      conversationId: row.conversation_id ?? undefined,
      taskName: row.task_name ?? undefined,
      replyPreview: row.reply_preview ?? undefined,
      errorMessage: row.error_message ?? undefined,
    };
  }
}
