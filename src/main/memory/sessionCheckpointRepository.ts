import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

import { MemoryKind, MemoryScope, MemorySourceKind } from '../../shared/memory';
import { runMigrations } from '../sqliteMigrations';
import { MemoryOutboxOperation, MemoryOutboxStatus, SessionCheckpointSyncState } from './constants';

export interface SessionCheckpointRecord {
  id: string;
  sessionId: string;
  projectId: string;
  content: string;
  metadata: Record<string, unknown>;
  sequence: number;
  syncStatus: string;
  syncError: string | null;
}

export interface SessionCheckpointCommitInput {
  id: string;
  sessionId: string;
  projectId: string;
  projectRoot: string;
  summary: string;
  metadata?: Record<string, unknown>;
  expiresAt: string;
}

export interface SessionCheckpointReceipt {
  checkpointId: string;
  syncState: 'pending' | 'synced' | 'superseded';
}

interface CheckpointRow {
  id: string;
  session_id: string;
  project_id: string;
  content: string;
  metadata_json: string;
  checkpoint_sequence: number;
  sync_status: string;
  sync_error: string | null;
}

export function migrateSessionCheckpointStorage(db: Database.Database): void {
  runMigrations(db, 'memory', [
    {
      version: 2,
      name: 'local-session-checkpoints',
      up: database => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS memory_checkpoints (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            checkpoint_sequence INTEGER NOT NULL,
            sync_status TEXT NOT NULL,
            sync_error TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(session_id, checkpoint_sequence)
          );
          CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_session
            ON memory_checkpoints(session_id, checkpoint_sequence DESC);
        `);
      },
    },
  ]);
}

export function commitSessionCheckpoint(
  db: Database.Database,
  input: SessionCheckpointCommitInput,
): SessionCheckpointRecord {
  return db.transaction(() => {
    const existing = getSessionCheckpoint(db, input.id);
    if (existing) {
      if (existing.sessionId !== input.sessionId || existing.projectId !== input.projectId) {
        throw new Error('Session checkpoint identity belongs to a different session or project.');
      }
      return existing;
    }
    const checkpointSequence = maxSessionCheckpointSequence(db, input.sessionId) + 1;
    const now = new Date().toISOString();
    const metadata = { ...input.metadata, checkpointSequence };
    db.prepare(
      `INSERT INTO memory_checkpoints (
        id, session_id, project_id, content, metadata_json, checkpoint_sequence,
        sync_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.sessionId,
      input.projectId,
      input.summary,
      JSON.stringify(metadata),
      checkpointSequence,
      MemoryOutboxStatus.Pending,
      now,
    );
    db.prepare(
      `INSERT INTO memory_outbox (
        id, link_id, operation, payload_json, status, available_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.id,
      MemoryOutboxOperation.SessionSummary,
      JSON.stringify({
        sessionId: input.sessionId,
        projectId: input.projectId,
        projectRoot: input.projectRoot,
        type: MemoryKind.SessionSummary,
        title: 'Session summary',
        content: input.summary,
        topicKey: `session/${input.sessionId}/checkpoint/${input.id}`,
        sourceKind: MemorySourceKind.SessionSummary,
        scope: MemoryScope.Session,
        linkId: input.id,
        metadata,
        expiresAt: input.expiresAt,
      }),
      MemoryOutboxStatus.Pending,
      now,
      now,
    );
    const committed = getSessionCheckpoint(db, input.id);
    if (!committed) throw new Error('Session checkpoint commit did not produce a local record.');
    return committed;
  })();
}

export function getSessionCheckpoint(
  db: Database.Database,
  id: string,
): SessionCheckpointRecord | null {
  const row = db.prepare('SELECT * FROM memory_checkpoints WHERE id = ?').get(id) as
    | CheckpointRow
    | undefined;
  return row ? mapCheckpoint(row) : null;
}

export function getLatestSessionCheckpoint(
  db: Database.Database,
  sessionId: string,
  projectId: string,
): SessionCheckpointRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM memory_checkpoints
       WHERE session_id = ? AND project_id = ?
       ORDER BY checkpoint_sequence DESC LIMIT 1`,
    )
    .get(sessionId, projectId) as CheckpointRow | undefined;
  return row ? mapCheckpoint(row) : null;
}

export function updateSessionCheckpointDelivery(
  db: Database.Database,
  outboxId: string,
  status: string,
  error: string | null,
): void {
  db.prepare(
    `UPDATE memory_checkpoints SET sync_status = ?, sync_error = ?
     WHERE id = (SELECT link_id FROM memory_outbox WHERE id = ?)`,
  ).run(status, error, outboxId);
}

export function checkpointReceipt(record: SessionCheckpointRecord): SessionCheckpointReceipt {
  return {
    checkpointId: record.id,
    syncState:
      record.syncStatus === SessionCheckpointSyncState.Synced
        ? SessionCheckpointSyncState.Synced
        : record.syncStatus === SessionCheckpointSyncState.Superseded
          ? SessionCheckpointSyncState.Superseded
          : SessionCheckpointSyncState.Pending,
  };
}

export function maxConfirmedSessionCheckpointSequence(
  db: Database.Database,
  sessionId: string,
): number {
  const rows = db
    .prepare('SELECT metadata_json FROM memory_links WHERE session_id = ?')
    .all(sessionId) as Array<{ metadata_json: string }>;
  let max = 0;
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata_json) as { checkpointSequence?: unknown };
    if (typeof metadata.checkpointSequence === 'number') {
      max = Math.max(max, metadata.checkpointSequence);
    }
  }
  return max;
}

export function maxSessionCheckpointSequence(db: Database.Database, sessionId: string): number {
  let max = maxConfirmedSessionCheckpointSequence(db, sessionId);
  const readSequence = (metadata: { checkpointSequence?: unknown }): void => {
    if (typeof metadata.checkpointSequence === 'number') {
      max = Math.max(max, metadata.checkpointSequence);
    }
  };
  const local = db
    .prepare(
      'SELECT MAX(checkpoint_sequence) AS sequence FROM memory_checkpoints WHERE session_id = ?',
    )
    .get(sessionId) as { sequence: number | null };
  max = Math.max(max, local.sequence ?? 0);
  const pending = db
    .prepare("SELECT payload_json FROM memory_outbox WHERE status IN ('pending', 'retry')")
    .all() as Array<{ payload_json: string }>;
  for (const row of pending) {
    const payload = JSON.parse(row.payload_json) as {
      sessionId?: string;
      metadata?: { checkpointSequence?: unknown };
    };
    if (payload.sessionId === sessionId) readSequence(payload.metadata ?? {});
  }
  return max;
}

function mapCheckpoint(row: CheckpointRow): SessionCheckpointRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    content: row.content,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    sequence: row.checkpoint_sequence,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
  };
}
