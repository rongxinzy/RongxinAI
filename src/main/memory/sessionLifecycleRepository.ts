import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

import { MemoryLifecycleStatus } from '../../shared/memory';
import { runMigrations } from '../sqliteMigrations';
import type { FinalizeSessionPayload } from './memoryOutboxPayloads';
import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';

export interface RuntimeSessionIdentityInput {
  localSessionId: string;
  runtimeSessionId: string;
  projectId: string;
  projectRoot: string;
  makeCurrent?: boolean;
}

export interface SessionFinalizationInput {
  sessionId: string;
  projectId: string;
  summary: string;
}

function migrateSessionLifecycleStorage(db: Database.Database): void {
  runMigrations(db, 'memory', [
    {
      version: 3,
      name: 'session-lifecycle-and-finalization-outbox',
      up: database => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS memory_runtime_sessions (
            local_session_id TEXT PRIMARY KEY,
            runtime_session_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL,
            project_root TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS memory_session_finalizations (
            runtime_session_id TEXT PRIMARY KEY,
            local_session_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL
          );
        `);
      },
    },
    {
      version: 4,
      name: 'runtime-session-history-and-current-pointer',
      up: database => {
        database.exec(`
          CREATE TABLE memory_runtime_sessions_v4 (
            local_session_id TEXT NOT NULL,
            runtime_session_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL,
            project_root TEXT NOT NULL,
            is_current INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(local_session_id, runtime_session_id)
          );
          INSERT INTO memory_runtime_sessions_v4 (
            local_session_id, runtime_session_id, project_id, project_root, is_current, updated_at
          )
          SELECT local_session_id, runtime_session_id, project_id, project_root, 1, updated_at
          FROM memory_runtime_sessions;
          DROP TABLE memory_runtime_sessions;
          ALTER TABLE memory_runtime_sessions_v4 RENAME TO memory_runtime_sessions;
          CREATE UNIQUE INDEX idx_memory_runtime_sessions_current
            ON memory_runtime_sessions(local_session_id) WHERE is_current = 1;
        `);
      },
    },
  ]);
}

function saveRuntimeSessionIdentity(
  db: Database.Database,
  input: RuntimeSessionIdentityInput,
): void {
  db.transaction(() => {
    const makeCurrent = input.makeCurrent !== false;
    if (makeCurrent) {
      db.prepare(
        'UPDATE memory_runtime_sessions SET is_current = 0 WHERE local_session_id = ?',
      ).run(input.localSessionId);
    }
    db.prepare(
      `INSERT INTO memory_runtime_sessions (
        local_session_id, runtime_session_id, project_id, project_root, is_current, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_session_id, runtime_session_id) DO UPDATE SET
        project_id = excluded.project_id,
        project_root = excluded.project_root,
        is_current = MAX(memory_runtime_sessions.is_current, excluded.is_current),
        updated_at = excluded.updated_at`,
    ).run(
      input.localSessionId,
      input.runtimeSessionId,
      input.projectId,
      input.projectRoot,
      makeCurrent ? 1 : 0,
      new Date().toISOString(),
    );
  })();
}

function getRuntimeSessionId(db: Database.Database, localSessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT runtime_session_id FROM memory_runtime_sessions
       WHERE local_session_id = ? AND is_current = 1 LIMIT 1`,
    )
    .get(localSessionId) as { runtime_session_id: string } | undefined;
  return row?.runtime_session_id ?? null;
}

function getLocalSessionIdByRuntimeId(
  db: Database.Database,
  runtimeSessionId: string,
): string | null {
  const row = db
    .prepare('SELECT local_session_id FROM memory_runtime_sessions WHERE runtime_session_id = ?')
    .get(runtimeSessionId) as { local_session_id: string } | undefined;
  return row?.local_session_id ?? null;
}

function queueSessionFinalizations(
  db: Database.Database,
  inputs: SessionFinalizationInput[],
  deleteSessions: () => void,
): void {
  db.transaction(() => {
    const now = new Date().toISOString();
    for (const input of inputs) {
      const runtimeSessionId = getRuntimeSessionId(db, input.sessionId) ?? input.sessionId;
      const previous = getSessionFinalization(db, runtimeSessionId);
      const hasPendingWork = hasPendingSessionWrites(db, input.sessionId);
      if (previous?.status === MemoryOutboxStatus.Completed && !hasPendingWork) continue;
      const intentKey =
        previous?.status === MemoryOutboxStatus.Completed
          ? `pending:${randomUUID()}`
          : runtimeSessionId;
      const linkId =
        previous?.status === MemoryOutboxStatus.Completed
          ? `finalize:${intentKey}`
          : `finalize:${runtimeSessionId}`;
      db.prepare(
        `INSERT INTO memory_session_finalizations (
          runtime_session_id, local_session_id, project_id, summary, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_session_id) DO NOTHING`,
      ).run(
        intentKey,
        input.sessionId,
        input.projectId,
        input.summary,
        MemoryOutboxStatus.Pending,
        now,
      );
      const intent = getSessionFinalization(db, intentKey);
      if (!intent) throw new Error('Session close intent was not persisted.');
      const existing =
        previous?.status === MemoryOutboxStatus.Completed
          ? undefined
          : (db
              .prepare(
                `SELECT id FROM memory_outbox
                 WHERE operation = ? AND json_extract(payload_json, '$.sessionId') = ?`,
              )
              .get(MemoryOutboxOperation.FinalizeSession, input.sessionId) as
              | { id: string }
              | undefined);
      const payload = JSON.stringify({
        sessionId: input.sessionId,
        runtimeSessionId,
        projectId: intent.projectId,
        summary: intent.summary,
      });
      if (existing) {
        db.prepare(
          `UPDATE memory_outbox SET status = ?, payload_json = ?, available_at = ?, last_error = NULL
           WHERE id = ?`,
        ).run(MemoryOutboxStatus.Pending, payload, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO memory_outbox (
            id, link_id, operation, payload_json, status, available_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          linkId,
          MemoryOutboxOperation.FinalizeSession,
          payload,
          MemoryOutboxStatus.Pending,
          now,
          now,
        );
      }
      db.prepare(
        'UPDATE memory_session_finalizations SET status = ?, error = NULL WHERE runtime_session_id = ?',
      ).run(MemoryOutboxStatus.Pending, intentKey);
    }
    deleteSessions();
  })();
}

function pendingSessionWriteAvailableAt(
  db: Database.Database,
  localSessionId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT MIN(available_at) AS available_at FROM memory_outbox
       WHERE status = ? AND operation IN (?, ?, ?)
         AND json_extract(payload_json, '$.sessionId') = ?`,
    )
    .get(
      MemoryOutboxStatus.Pending,
      MemoryOutboxOperation.Confirm,
      MemoryOutboxOperation.SessionSummary,
      MemoryOutboxOperation.Supersede,
      localSessionId,
    ) as { available_at: string | null };
  return row.available_at;
}

function hasPendingSessionWrites(db: Database.Database, localSessionId: string): boolean {
  return pendingSessionWriteAvailableAt(db, localSessionId) !== null;
}

function resolveSessionFinalization(
  db: Database.Database,
  outboxId: string,
  localSessionId: string,
): FinalizeSessionPayload {
  const row = db
    .prepare('SELECT link_id, payload_json FROM memory_outbox WHERE id = ?')
    .get(outboxId) as { link_id: string | null; payload_json: string };
  const payload = JSON.parse(row.payload_json) as FinalizeSessionPayload;
  const intentKey = row.link_id?.startsWith('finalize:')
    ? row.link_id.slice('finalize:'.length)
    : payload.runtimeSessionId;
  const runtimeSessionId = getRuntimeSessionId(db, localSessionId) ?? payload.runtimeSessionId;
  if (runtimeSessionId === payload.runtimeSessionId) return payload;
  const next = { ...payload, runtimeSessionId };
  db.transaction(() => {
    const target = db
      .prepare(
        'SELECT local_session_id FROM memory_session_finalizations WHERE runtime_session_id = ?',
      )
      .get(runtimeSessionId) as { local_session_id: string } | undefined;
    if (target) {
      if (target.local_session_id !== localSessionId) {
        throw new Error('Finalization continuation belongs to a different local session.');
      }
      db.prepare('DELETE FROM memory_session_finalizations WHERE runtime_session_id = ?').run(
        intentKey,
      );
      db.prepare(
        `INSERT INTO memory_session_finalizations (
          runtime_session_id, local_session_id, project_id, summary, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_session_id) DO UPDATE SET
          local_session_id = excluded.local_session_id,
          project_id = excluded.project_id,
          summary = excluded.summary`,
      ).run(
        runtimeSessionId,
        localSessionId,
        payload.projectId,
        payload.summary,
        MemoryOutboxStatus.Pending,
        new Date().toISOString(),
      );
    } else {
      db.prepare(
        'UPDATE memory_session_finalizations SET runtime_session_id = ? WHERE runtime_session_id = ?',
      ).run(runtimeSessionId, intentKey);
    }
    db.prepare('UPDATE memory_outbox SET link_id = ?, payload_json = ? WHERE id = ?').run(
      `finalize:${runtimeSessionId}`,
      JSON.stringify(next),
      outboxId,
    );
  })();
  return next;
}

function deferSessionFinalization(
  db: Database.Database,
  outboxId: string,
  localSessionId: string,
): boolean {
  const nextAvailableAt = pendingSessionWriteAvailableAt(db, localSessionId);
  if (!nextAvailableAt) return false;
  db.transaction(() => {
    const message = 'Waiting for earlier session writes.';
    db.prepare('UPDATE memory_outbox SET available_at = ?, last_error = ? WHERE id = ?').run(
      nextAvailableAt,
      message,
      outboxId,
    );
    db.prepare(
      `UPDATE memory_session_finalizations SET status = ?, error = ?
       WHERE runtime_session_id = (
         SELECT substr(link_id, 10) FROM memory_outbox WHERE id = ?
       )`,
    ).run(MemoryOutboxStatus.Pending, message, outboxId);
  })();
  return true;
}

function getSessionFinalization(
  db: Database.Database,
  runtimeSessionId: string,
): { summary: string; projectId: string; status: string; error: string | null } | null {
  const row = db
    .prepare(
      `SELECT summary, project_id, status, error FROM memory_session_finalizations
       WHERE runtime_session_id = ?`,
    )
    .get(runtimeSessionId) as
    | { summary: string; project_id: string; status: string; error: string | null }
    | undefined;
  return row
    ? { summary: row.summary, projectId: row.project_id, status: row.status, error: row.error }
    : null;
}

export { getSessionFinalization };

function updateSessionFinalization(
  db: Database.Database,
  outboxId: string,
  status: string,
  error: string | null,
): void {
  db.transaction(() => {
    if (status === MemoryOutboxStatus.Completed) {
      db.prepare(
        'UPDATE memory_outbox SET status = ?, completed_at = ?, last_error = NULL WHERE id = ?',
      ).run(status, new Date().toISOString(), outboxId);
    } else {
      db.prepare('UPDATE memory_outbox SET status = ?, last_error = ? WHERE id = ?').run(
        status,
        error,
        outboxId,
      );
    }
    db.prepare(
      `UPDATE memory_session_finalizations SET status = ?, error = ?
       WHERE runtime_session_id = (
         SELECT substr(link_id, 10) FROM memory_outbox WHERE id = ?
       )`,
    ).run(status, error, outboxId);
  })();
}

export class SessionLifecycleStore {
  constructor(private readonly db: Database.Database) {
    if (typeof db.prepare === 'function') migrateSessionLifecycleStorage(db);
  }

  getRuntimeSessionId(localSessionId: string): string | null {
    return getRuntimeSessionId(this.db, localSessionId);
  }

  getLocalSessionIdByRuntimeId(runtimeSessionId: string): string | null {
    return getLocalSessionIdByRuntimeId(this.db, runtimeSessionId);
  }

  saveRuntimeSessionId(input: RuntimeSessionIdentityInput): void {
    saveRuntimeSessionIdentity(this.db, input);
  }

  queueSessionFinalizations(inputs: SessionFinalizationInput[], deleteSessions: () => void): void {
    queueSessionFinalizations(this.db, inputs, deleteSessions);
  }

  resolveSessionFinalization(outboxId: string, localSessionId: string): FinalizeSessionPayload {
    return resolveSessionFinalization(this.db, outboxId, localSessionId);
  }

  deferSessionFinalization(outboxId: string, localSessionId: string): boolean {
    return deferSessionFinalization(this.db, outboxId, localSessionId);
  }

  completeSessionFinalization(outboxId: string): void {
    updateSessionFinalization(this.db, outboxId, MemoryOutboxStatus.Completed, null);
  }

  failSessionFinalization(outboxId: string, error: string): void {
    updateSessionFinalization(this.db, outboxId, MemoryOutboxStatus.Failed, error);
  }

  hasOtherObservationReferences(memoryId: number, excludedLinkId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM memory_links
         WHERE memory_id = ? AND id <> ? AND status <> ? LIMIT 1`,
      )
      .get(memoryId, excludedLinkId, MemoryLifecycleStatus.Deleted);
    return Boolean(row);
  }
}
