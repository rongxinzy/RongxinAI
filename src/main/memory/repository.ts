import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  MemoryLinkStatus,
  MemoryOutboxStatus,
  type EngramMemoryScope,
  type MemoryOutboxOperation,
  type MemorySourceKind,
} from './constants';

export interface MemoryLinkInput {
  id?: string;
  memoryId: number;
  projectId: string;
  scope: EngramMemoryScope;
  sessionId: string;
  sourceKind: MemorySourceKind;
  taskId?: string;
  runId?: string;
  artifactId?: string;
  approvalId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryOutboxItem {
  id: string;
  operation: MemoryOutboxOperation;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  availableAt: string;
  lastError: string | null;
}

interface MemoryOutboxRow {
  id: string;
  operation: MemoryOutboxOperation;
  payload_json: string;
  status: string;
  attempts: number;
  available_at: string;
  last_error: string | null;
}

export class MemoryRepository {
  constructor(private readonly db: Database.Database) {
    this.ensureSchema();
  }

  createLink(input: MemoryLinkInput): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO memory_links (
          id, memory_id, project_id, scope, session_id, source_kind,
          task_id, run_id, artifact_id, approval_id, status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.memoryId,
        input.projectId,
        input.scope,
        input.sessionId,
        input.sourceKind,
        input.taskId ?? null,
        input.runId ?? null,
        input.artifactId ?? null,
        input.approvalId ?? null,
        MemoryLinkStatus.Active,
        JSON.stringify(input.metadata ?? {}),
      );
    return id;
  }

  enqueue(operation: MemoryOutboxOperation, payload: Record<string, unknown>): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO memory_outbox (id, operation, payload_json, status, available_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        operation,
        JSON.stringify(payload),
        MemoryOutboxStatus.Pending,
        new Date().toISOString(),
      );
    return id;
  }

  listPending(limit = 20): MemoryOutboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, operation, payload_json, status, attempts, available_at, last_error
         FROM memory_outbox
         WHERE status = ? AND available_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(MemoryOutboxStatus.Pending, new Date().toISOString(), limit) as MemoryOutboxRow[];
    return rows.map(row => ({
      id: row.id,
      operation: row.operation,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      status: row.status,
      attempts: row.attempts,
      availableAt: row.available_at,
      lastError: row.last_error,
    }));
  }

  markCompleted(id: string): void {
    this.db
      .prepare(
        `UPDATE memory_outbox
         SET status = ?, completed_at = ?, last_error = NULL
         WHERE id = ?`,
      )
      .run(MemoryOutboxStatus.Completed, new Date().toISOString(), id);
  }

  markRetry(id: string, attempts: number, error: string): void {
    const nextAttemptAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** attempts));
    this.db
      .prepare(
        `UPDATE memory_outbox
         SET attempts = ?, available_at = ?, last_error = ?
         WHERE id = ?`,
      )
      .run(attempts, nextAttemptAt.toISOString(), error, id);
  }

  countLinks(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM memory_links WHERE project_id = ? AND status = ?')
      .get(projectId, MemoryLinkStatus.Active) as { count: number };
    return row.count;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        memory_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        task_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        approval_id TEXT,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_links_project
        ON memory_links(project_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_links_session
        ON memory_links(session_id, status);

      CREATE TABLE IF NOT EXISTS memory_outbox (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_outbox_pending
        ON memory_outbox(status, available_at, created_at);
    `);
  }
}
