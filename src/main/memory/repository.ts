import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type { ManagedMemoryListInput, ManagedMemoryRecord } from '../../shared/memory';
import {
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  PERSONAL_MEMORY_PROJECT_ID,
  type MemoryKind,
} from '../../shared/memory';
import { MemoryOutboxStatus, type MemoryOutboxOperation, type MemorySourceKind } from './constants';

export interface MemoryProjectionInput {
  title: string;
  content: string;
  kind: MemoryKind;
  topicKey?: string;
  importance?: number;
  confidence?: number;
  sensitivity?: (typeof MemorySensitivity)[keyof typeof MemorySensitivity];
  expiresAt?: string;
}

export interface MemoryLinkInput extends MemoryProjectionInput {
  id?: string;
  memoryId: number;
  projectId: string;
  scope: MemoryScope;
  sessionId: string;
  sourceKind: MemorySourceKind;
  taskId?: string;
  runId?: string;
  artifactId?: string;
  approvalId?: string;
  promotedFromLinkId?: string;
  promotionSourceProjectId?: string;
  promotionSourceSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalMemoryCandidateInput extends MemoryProjectionInput {
  id?: string;
  projectId?: string;
  projectRoot?: string;
  scope?: MemoryScope;
  sessionId: string;
  sourceKind: MemorySourceKind;
  taskId?: string;
  runId?: string;
  artifactId?: string;
  approvalId?: string;
  supersedesLinkId?: string;
  promotedFromLinkId?: string;
  promotionSourceProjectId?: string;
  promotionSourceSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryOutboxItem {
  id: string;
  linkId: string | null;
  operation: MemoryOutboxOperation;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  availableAt: string;
  lastError: string | null;
}

export interface MemoryRecallMetadata {
  importance: number;
  updatedAt: string;
}

export interface RecallableMemoryFilter {
  projectId: string;
  memoryIds: number[];
  scope: MemoryScope;
  sessionId?: string;
}

interface MemoryOutboxRow {
  id: string;
  link_id: string | null;
  operation: MemoryOutboxOperation;
  payload_json: string;
  status: string;
  attempts: number;
  available_at: string;
  last_error: string | null;
}

type SqlRow = Record<string, unknown>;

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
          task_id, run_id, artifact_id, approval_id, status, title, content,
          kind, topic_key, importance, confidence, sensitivity, expires_at,
          promoted_from_link_id, promotion_source_project_id,
          promotion_source_session_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          memory_id = excluded.memory_id,
          status = excluded.status,
          title = excluded.title,
          content = excluded.content,
          kind = excluded.kind,
          topic_key = excluded.topic_key,
          importance = excluded.importance,
          confidence = excluded.confidence,
          sensitivity = excluded.sensitivity,
          expires_at = excluded.expires_at,
          promoted_from_link_id = excluded.promoted_from_link_id,
          promotion_source_project_id = excluded.promotion_source_project_id,
          promotion_source_session_id = excluded.promotion_source_session_id,
          metadata_json = excluded.metadata_json,
          updated_at = datetime('now')`,
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
        MemoryLifecycleStatus.Active,
        input.title,
        input.content,
        input.kind,
        input.topicKey ?? null,
        clampScore(input.importance),
        clampScore(input.confidence),
        input.sensitivity ?? MemorySensitivity.Normal,
        input.expiresAt ?? null,
        input.promotedFromLinkId ?? null,
        input.promotionSourceProjectId ?? null,
        input.promotionSourceSessionId ?? null,
        JSON.stringify(input.metadata ?? {}),
      );
    return id;
  }

  createPersonalCandidate(input: PersonalMemoryCandidateInput): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO memory_candidates (
          id, project_id, project_root, scope, session_id, source_kind,
          task_id, run_id, artifact_id, approval_id,
          status, title, content, kind, topic_key, importance, confidence,
          sensitivity, expires_at, supersedes_link_id, promoted_from_link_id,
          promotion_source_project_id, promotion_source_session_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId ?? PERSONAL_MEMORY_PROJECT_ID,
        input.projectRoot ?? '',
        input.scope ?? MemoryScope.Personal,
        input.sessionId,
        input.sourceKind,
        input.taskId ?? null,
        input.runId ?? null,
        input.artifactId ?? null,
        input.approvalId ?? null,
        MemoryLifecycleStatus.NeedsReview,
        input.title,
        input.content,
        input.kind,
        input.topicKey ?? null,
        clampScore(input.importance),
        clampScore(input.confidence),
        input.sensitivity ?? MemorySensitivity.Normal,
        input.expiresAt ?? null,
        input.supersedesLinkId ?? null,
        input.promotedFromLinkId ?? null,
        input.promotionSourceProjectId ?? null,
        input.promotionSourceSessionId ?? null,
        JSON.stringify(input.metadata ?? {}),
      );
    return id;
  }

  getCandidate(id: string): ManagedMemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(id) as
      | SqlRow
      | undefined;
    return row ? mapCandidate(row, this.getDelivery(id)) : null;
  }

  getCandidateDetails(id: string): {
    supersedesLinkId: string | null;
    promotedFromLinkId: string | null;
    promotionSourceProjectId: string | null;
    promotionSourceSessionId: string | null;
    projectRoot: string;
    metadata: Record<string, unknown>;
  } | null {
    const row = this.db
      .prepare(
        `SELECT supersedes_link_id, promoted_from_link_id, promotion_source_project_id,
                promotion_source_session_id, project_root, metadata_json
         FROM memory_candidates WHERE id = ?`,
      )
      .get(id) as
      | {
          supersedes_link_id: string | null;
          promoted_from_link_id: string | null;
          promotion_source_project_id: string | null;
          promotion_source_session_id: string | null;
          project_root: string;
          metadata_json: string;
        }
      | undefined;
    return row
      ? {
          supersedesLinkId: row.supersedes_link_id,
          promotedFromLinkId: row.promoted_from_link_id,
          promotionSourceProjectId: row.promotion_source_project_id,
          promotionSourceSessionId: row.promotion_source_session_id,
          projectRoot: row.project_root,
          metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
        }
      : null;
  }

  getLink(id: string): ManagedMemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memory_links WHERE id = ?').get(id) as
      | SqlRow
      | undefined;
    return row ? mapLink(row, this.getDelivery(id)) : null;
  }

  getLinkMetadata(id: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT metadata_json FROM memory_links WHERE id = ?').get(id) as
      | { metadata_json: string }
      | undefined;
    return row ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {};
  }

  findActiveTopic(
    projectId: string,
    scope: MemoryScope,
    topicKey: string,
  ): ManagedMemoryRecord | null {
    this.expireDue();
    const row = this.db
      .prepare(
        `SELECT * FROM memory_links
         WHERE project_id = ? AND scope = ? AND topic_key = ? AND status = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(projectId, scope, topicKey, MemoryLifecycleStatus.Active) as SqlRow | undefined;
    return row ? mapLink(row, this.getDelivery(String(row.id))) : null;
  }

  findLinkByMemoryId(memoryId: number): ManagedMemoryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM memory_links WHERE memory_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(memoryId) as SqlRow | undefined;
    return row ? mapLink(row, this.getDelivery(String(row.id))) : null;
  }

  deleteCandidate(id: string): void {
    this.db.prepare('DELETE FROM memory_candidates WHERE id = ?').run(id);
  }

  enqueue(
    operation: MemoryOutboxOperation,
    payload: Record<string, unknown>,
    linkId?: string,
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO memory_outbox (id, link_id, operation, payload_json, status, available_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        linkId ?? null,
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
        `SELECT id, link_id, operation, payload_json, status, attempts, available_at, last_error
         FROM memory_outbox
         WHERE status = ? AND available_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(MemoryOutboxStatus.Pending, new Date().toISOString(), limit) as MemoryOutboxRow[];
    return rows.map(mapOutbox);
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

  makePendingAvailable(): void {
    this.db
      .prepare('UPDATE memory_outbox SET available_at = ? WHERE status = ?')
      .run(new Date().toISOString(), MemoryOutboxStatus.Pending);
  }

  listManaged(input: ManagedMemoryListInput = {}): ManagedMemoryRecord[] {
    this.expireDue();
    const links = this.db
      .prepare('SELECT * FROM memory_links ORDER BY updated_at DESC')
      .all() as SqlRow[];
    const candidates = this.db
      .prepare('SELECT * FROM memory_candidates ORDER BY updated_at DESC')
      .all() as SqlRow[];
    const records = [
      ...links.map(row => mapLink(row, this.getDelivery(String(row.id)))),
      ...candidates.map(row => mapCandidate(row, this.getDelivery(String(row.id)))),
    ];
    const query = input.query?.trim().toLocaleLowerCase();
    return records
      .filter(record => !input.scope || record.scope === input.scope)
      .filter(record => !input.status || record.status === input.status)
      .filter(
        record =>
          !query ||
          record.title.toLocaleLowerCase().includes(query) ||
          record.content.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  filterRecallableMemoryIds(input: RecallableMemoryFilter): Set<number> {
    if (input.memoryIds.length === 0) return new Set();
    this.expireDue();
    const placeholders = input.memoryIds.map(() => '?').join(', ');
    const sessionClause = input.scope === MemoryScope.Session ? ' AND session_id = ?' : '';
    if (input.scope === MemoryScope.Session && !input.sessionId) return new Set();
    const parameters = [
      input.projectId,
      MemoryLifecycleStatus.Active,
      input.scope,
      ...input.memoryIds,
      ...(input.scope === MemoryScope.Session ? [input.sessionId] : []),
    ];
    const rows = this.db
      .prepare(
        `SELECT memory_id FROM memory_links
         WHERE project_id = ? AND status = ? AND scope = ?
           AND memory_id IN (${placeholders})${sessionClause}`,
      )
      .all(...parameters) as Array<{ memory_id: number }>;
    return new Set(rows.map(row => row.memory_id));
  }

  getRecallMetadata(projectId: string, memoryIds: number[]): Map<number, MemoryRecallMetadata> {
    if (memoryIds.length === 0) return new Map();
    this.expireDue();
    const placeholders = memoryIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT memory_id, importance, updated_at FROM memory_links
         WHERE project_id = ? AND status = ? AND memory_id IN (${placeholders})`,
      )
      .all(projectId, MemoryLifecycleStatus.Active, ...memoryIds) as Array<{
      memory_id: number;
      importance: number;
      updated_at: string;
    }>;
    return new Map(
      rows.map(row => [row.memory_id, { importance: row.importance, updatedAt: row.updated_at }]),
    );
  }

  setLinkStatus(id: string, status: MemoryLifecycleStatus, supersededBy?: string): void {
    this.db
      .prepare(
        `UPDATE memory_links
         SET status = ?, superseded_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, supersededBy ?? null, new Date().toISOString(), id);
  }

  supersedeActiveTopic(
    projectId: string,
    scope: MemoryScope,
    topicKey: string,
    replacementId: string,
  ): void {
    this.db
      .prepare(
        `UPDATE memory_links
         SET status = ?, superseded_by = ?, updated_at = ?
         WHERE project_id = ? AND scope = ? AND topic_key = ? AND id <> ? AND status = ?`,
      )
      .run(
        MemoryLifecycleStatus.Superseded,
        replacementId,
        new Date().toISOString(),
        projectId,
        scope,
        topicKey,
        replacementId,
        MemoryLifecycleStatus.Active,
      );
  }

  restoreLink(id: string): void {
    this.db
      .prepare(
        `UPDATE memory_links
         SET status = ?, expires_at = NULL, superseded_by = NULL, updated_at = ?
         WHERE id = ? AND status IN (?, ?)`,
      )
      .run(
        MemoryLifecycleStatus.Active,
        new Date().toISOString(),
        id,
        MemoryLifecycleStatus.Archived,
        MemoryLifecycleStatus.Expired,
      );
  }

  deleteLink(id: string): void {
    this.db.prepare('DELETE FROM memory_links WHERE id = ?').run(id);
  }

  countLinks(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM memory_links WHERE project_id = ? AND status = ?')
      .get(projectId, MemoryLifecycleStatus.Active) as { count: number };
    return row.count;
  }

  private expireDue(): void {
    this.db
      .prepare(
        `UPDATE memory_links SET status = ?, updated_at = ?
         WHERE status = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(
        MemoryLifecycleStatus.Expired,
        new Date().toISOString(),
        MemoryLifecycleStatus.Active,
        new Date().toISOString(),
      );
  }

  private getDelivery(linkId: string): { status: string; error: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT status, last_error AS error FROM memory_outbox
         WHERE link_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(linkId) as { status: string; error: string | null } | undefined;
    return row ?? null;
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
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'decision',
        topic_key TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        expires_at TEXT,
        superseded_by TEXT,
        promoted_from_link_id TEXT,
        promotion_source_project_id TEXT,
        promotion_source_session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_links_project
        ON memory_links(project_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_links_session
        ON memory_links(session_id, status);

      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'personal://zhiyuan-agent/user',
        project_root TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'personal',
        session_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        task_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        approval_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        topic_key TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        expires_at TEXT,
        supersedes_link_id TEXT,
        promoted_from_link_id TEXT,
        promotion_source_project_id TEXT,
        promotion_source_session_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memory_outbox (
        id TEXT PRIMARY KEY,
        link_id TEXT,
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
    this.ensureAddedColumns();
  }

  private ensureAddedColumns(): void {
    if (typeof this.db.prepare !== 'function') return;
    const additions: Record<string, string> = {
      title: "TEXT NOT NULL DEFAULT ''",
      content: "TEXT NOT NULL DEFAULT ''",
      kind: "TEXT NOT NULL DEFAULT 'decision'",
      topic_key: 'TEXT',
      importance: 'REAL NOT NULL DEFAULT 0.5',
      confidence: 'REAL NOT NULL DEFAULT 0.5',
      sensitivity: "TEXT NOT NULL DEFAULT 'normal'",
      expires_at: 'TEXT',
      superseded_by: 'TEXT',
      promoted_from_link_id: 'TEXT',
      promotion_source_project_id: 'TEXT',
      promotion_source_session_id: 'TEXT',
    };
    const columns = this.db.prepare('PRAGMA table_info(memory_links)').all() as Array<{
      name: string;
    }>;
    const existing = new Set(columns.map(column => column.name));
    for (const [name, definition] of Object.entries(additions)) {
      if (!existing.has(name))
        this.db.exec(`ALTER TABLE memory_links ADD COLUMN ${name} ${definition}`);
    }
    const outboxColumns = this.db.prepare('PRAGMA table_info(memory_outbox)').all() as Array<{
      name: string;
    }>;
    if (!outboxColumns.some(column => column.name === 'link_id')) {
      this.db.exec('ALTER TABLE memory_outbox ADD COLUMN link_id TEXT');
    }
    const candidateAdditions: Record<string, string> = {
      project_id: "TEXT NOT NULL DEFAULT 'personal://zhiyuan-agent/user'",
      project_root: "TEXT NOT NULL DEFAULT ''",
      scope: "TEXT NOT NULL DEFAULT 'personal'",
      promoted_from_link_id: 'TEXT',
      promotion_source_project_id: 'TEXT',
      promotion_source_session_id: 'TEXT',
    };
    const candidateColumns = this.db
      .prepare('PRAGMA table_info(memory_candidates)')
      .all() as Array<{
      name: string;
    }>;
    const existingCandidateColumns = new Set(candidateColumns.map(column => column.name));
    for (const [name, definition] of Object.entries(candidateAdditions)) {
      if (!existingCandidateColumns.has(name)) {
        this.db.exec(`ALTER TABLE memory_candidates ADD COLUMN ${name} ${definition}`);
      }
    }
  }
}

function mapOutbox(row: MemoryOutboxRow): MemoryOutboxItem {
  return {
    id: row.id,
    linkId: row.link_id,
    operation: row.operation,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lastError: row.last_error,
  };
}

function mapLink(
  row: SqlRow,
  delivery: { status: string; error: string | null } | null,
): ManagedMemoryRecord {
  return mapRecord(row, delivery, Number(row.memory_id), String(row.project_id), String(row.scope));
}

function mapCandidate(
  row: SqlRow,
  delivery: { status: string; error: string | null } | null,
): ManagedMemoryRecord {
  return mapRecord(row, delivery, null, String(row.project_id), String(row.scope));
}

function mapRecord(
  row: SqlRow,
  delivery: { status: string; error: string | null } | null,
  memoryId: number | null,
  projectId: string,
  scope: string,
): ManagedMemoryRecord {
  return {
    id: String(row.id),
    memoryId,
    projectId,
    scope: scope as ManagedMemoryRecord['scope'],
    sessionId: String(row.session_id),
    sourceKind: String(row.source_kind) as ManagedMemoryRecord['sourceKind'],
    taskId: nullableString(row.task_id),
    runId: nullableString(row.run_id),
    artifactId: nullableString(row.artifact_id),
    approvalId: nullableString(row.approval_id),
    status: String(row.status) as ManagedMemoryRecord['status'],
    title: String(row.title),
    content: String(row.content),
    kind: String(row.kind) as ManagedMemoryRecord['kind'],
    topicKey: nullableString(row.topic_key),
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    sensitivity: String(row.sensitivity) as ManagedMemoryRecord['sensitivity'],
    expiresAt: nullableString(row.expires_at),
    supersededBy: nullableString(row.superseded_by),
    promotedFromLinkId: nullableString(row.promoted_from_link_id),
    promotionSourceProjectId: nullableString(row.promotion_source_project_id),
    promotionSourceSessionId: nullableString(row.promotion_source_session_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deliveryStatus: delivery ? (delivery.status as ManagedMemoryRecord['deliveryStatus']) : null,
    deliveryError: delivery?.error ?? null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function clampScore(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 0.5));
}
