import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

import { MemoryLifecycleStatus } from '../../shared/memory';
import { runMigrations } from '../sqliteMigrations';
import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';

export interface RuntimeSessionIdentityInput {
  localSessionId: string;
  runtimeSessionId: string;
  projectId: string;
  projectRoot: string;
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
  ]);
}

function saveRuntimeSessionIdentity(
  db: Database.Database,
  input: RuntimeSessionIdentityInput,
): void {
  db.prepare(
    `INSERT INTO memory_runtime_sessions (
      local_session_id, runtime_session_id, project_id, project_root, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(local_session_id) DO UPDATE SET
      runtime_session_id = excluded.runtime_session_id,
      project_id = excluded.project_id,
      project_root = excluded.project_root,
      updated_at = excluded.updated_at`,
  ).run(
    input.localSessionId,
    input.runtimeSessionId,
    input.projectId,
    input.projectRoot,
    new Date().toISOString(),
  );
}

function getRuntimeSessionId(db: Database.Database, localSessionId: string): string | null {
  const row = db
    .prepare('SELECT runtime_session_id FROM memory_runtime_sessions WHERE local_session_id = ?')
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
      const linkId = `finalize:${runtimeSessionId}`;
      db.prepare(
        `INSERT INTO memory_session_finalizations (
          runtime_session_id, local_session_id, project_id, summary, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(runtime_session_id) DO NOTHING`,
      ).run(
        runtimeSessionId,
        input.sessionId,
        input.projectId,
        input.summary,
        MemoryOutboxStatus.Pending,
        now,
      );
      const intent = getSessionFinalization(db, runtimeSessionId);
      if (!intent || intent.status === MemoryOutboxStatus.Completed) continue;
      const existing = db
        .prepare('SELECT id FROM memory_outbox WHERE link_id = ? AND operation = ?')
        .get(linkId, MemoryOutboxOperation.FinalizeSession) as { id: string } | undefined;
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
      ).run(MemoryOutboxStatus.Pending, runtimeSessionId);
    }
    deleteSessions();
  })();
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
         SELECT json_extract(payload_json, '$.runtimeSessionId') FROM memory_outbox WHERE id = ?
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
