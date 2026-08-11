/**
 * One-time import of pre-canonical SQLite scheduler data. It never contacts an
 * Agent runtime: SQLite remains the sole authority for Tasks and Runs.
 */

import type Database from 'better-sqlite3';

import {
  DefaultAgentId,
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';
import type { Schedule, ScheduledTaskDelivery, ScheduledTaskInput } from './types';

interface LegacySchedule {
  type: 'at' | 'interval' | 'cron';
  datetime?: string;
  intervalMs?: number;
  expression?: string;
}

interface LegacyTaskRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  schedule_json: string;
  prompt: string;
  notify_platforms_json: string;
}

interface LegacyRunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

function formatLocalTimezoneOffset(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  return `${sign}${Math.floor(absMinutes / 60).toString().padStart(2, '0')}:${(absMinutes % 60).toString().padStart(2, '0')}`;
}

function ensureTimezoneOffset(datetime: string): string {
  if (/(?:Z|[+-]\d{2}:\d{2})\s*$/.test(datetime)) return datetime;
  return `${datetime}${formatLocalTimezoneOffset()}`;
}

function convertSchedule(legacy: LegacySchedule, preservePastAt = false): Schedule | null {
  if (legacy.type === 'at') {
    if (!legacy.datetime) return null;
    const at = ensureTimezoneOffset(legacy.datetime);
    if (!preservePastAt && new Date(at).getTime() <= Date.now()) return null;
    return { kind: ScheduleKind.At, at };
  }
  if (legacy.type === 'interval') {
    return legacy.intervalMs && legacy.intervalMs > 0
      ? { kind: ScheduleKind.Every, everyMs: legacy.intervalMs }
      : null;
  }
  return legacy.expression ? { kind: ScheduleKind.Cron, expr: legacy.expression } : null;
}

function convertDelivery(platformsJson: string): ScheduledTaskDelivery {
  let platforms: unknown;
  try { platforms = JSON.parse(platformsJson); } catch { return { mode: DeliveryMode.None }; }
  return Array.isArray(platforms) && typeof platforms[0] === 'string'
    ? { mode: DeliveryMode.Announce, channel: platforms[0] }
    : { mode: DeliveryMode.None };
}

function rowToInput(row: LegacyTaskRow): ScheduledTaskInput | null {
  let legacy: LegacySchedule;
  try { legacy = JSON.parse(row.schedule_json) as LegacySchedule; } catch { return null; }
  const schedule = convertSchedule(legacy, true);
  if (!schedule) return null;
  return {
    name: row.name,
    description: row.description ?? '',
    enabled: row.enabled === 1,
    schedule,
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: PayloadKind.AgentTurn, message: row.prompt },
    delivery: convertDelivery(row.notify_platforms_json ?? '[]'),
    agentId: DefaultAgentId,
  };
}

/** Imports legacy task records without creating runtime jobs. */
export async function migrateLegacyScheduledTasksToCanonical(deps: {
  db: Database.Database;
  getKv: (key: string) => unknown;
  setKv: (key: string, value: string) => void;
  store: SqliteScheduledTaskStore;
}): Promise<void> {
  const key = 'scheduled_tasks_migrated_to_canonical_v1';
  if (deps.getKv(key) === 'true') return;
  const exists = deps.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_tasks'").get();
  if (!exists) { deps.setKv(key, 'true'); return; }
  const rows = deps.db.prepare('SELECT id, name, description, enabled, schedule_json, prompt, notify_platforms_json FROM scheduled_tasks').all() as LegacyTaskRow[];
  for (const row of rows) {
    const input = rowToInput(row);
    if (input) deps.store.importLegacy(row.id, input);
  }
  deps.setKv(key, 'true');
}

/** Imports legacy Run history without writing OpenClaw JSONL state. */
export async function migrateLegacyScheduledTaskRunsToCanonical(deps: {
  db: Database.Database;
  getKv: (key: string) => unknown;
  setKv: (key: string, value: string) => void;
  store: SqliteScheduledTaskStore;
}): Promise<void> {
  const key = 'scheduled_task_runs_migrated_to_canonical_v1';
  if (deps.getKv(key) === 'true') return;
  const exists = deps.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_task_runs'").get();
  if (!exists) { deps.setKv(key, 'true'); return; }
  const rows = deps.db.prepare('SELECT id, task_id, session_id, status, started_at, finished_at, duration_ms, error FROM scheduled_task_runs').all() as LegacyRunRow[];
  for (const row of rows) {
    deps.store.importLegacyRun({
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      sessionKey: null,
      status: row.status === 'success' ? TaskStatus.Success : row.status === 'error' ? TaskStatus.Error : TaskStatus.Skipped,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      error: row.error,
    });
  }
  deps.setKv(key, 'true');
}
