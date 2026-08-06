import type Database from 'better-sqlite3';

import type { CoworkPersistedArtifact } from '../shared/cowork/artifacts';
import {
  collectSessionArtifactCandidates,
  type CoworkArtifactCandidate,
  type CoworkArtifactMessage,
} from './coworkArtifactCollector';

export const COWORK_ARTIFACT_INDEX_VERSION = 2;

interface ArtifactIndexStateRow {
  cursor_sequence: number;
  index_version: number;
}

interface ArtifactRow {
  id: string;
  message_id: string;
  type: CoworkPersistedArtifact['type'];
  title: string;
  content: string;
  language: string | null;
  file_name: string | null;
  file_path: string | null;
  source: CoworkPersistedArtifact['source'];
  role: CoworkPersistedArtifact['role'];
  declared: number;
  created_at: number;
}

interface MessageRow {
  id: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: number;
  sequence: number;
}

export function initializeCoworkArtifactIndexSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_session_artifacts (
      session_id TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      language TEXT,
      file_name TEXT,
      file_path TEXT,
      source TEXT NOT NULL,
      role TEXT NOT NULL,
      declared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, artifact_key),
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cowork_artifact_index_state (
      session_id TEXT PRIMARY KEY,
      cursor_sequence INTEGER NOT NULL DEFAULT 0,
      index_version INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cowork_messages_session_sequence
      ON cowork_messages(session_id, sequence);

    CREATE TRIGGER IF NOT EXISTS trg_cowork_artifact_index_message_update
    AFTER UPDATE OF type, content, metadata, sequence ON cowork_messages
    WHEN COALESCE(OLD.sequence, 0) <= COALESCE(
      (SELECT cursor_sequence FROM cowork_artifact_index_state
       WHERE session_id = OLD.session_id),
      -1
    )
    BEGIN
      DELETE FROM cowork_artifact_index_state WHERE session_id = OLD.session_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cowork_artifact_index_message_delete
    AFTER DELETE ON cowork_messages
    WHEN COALESCE(OLD.sequence, 0) <= COALESCE(
      (SELECT cursor_sequence FROM cowork_artifact_index_state
       WHERE session_id = OLD.session_id),
      -1
    )
    BEGIN
      DELETE FROM cowork_artifact_index_state WHERE session_id = OLD.session_id;
    END;
  `);
}

export class CoworkArtifactIndex {
  constructor(private readonly db: Database.Database) {}

  refreshSession(sessionId: string): CoworkPersistedArtifact[] {
    return this.db.transaction(() => {
      const state = this.db
        .prepare(
          `SELECT cursor_sequence, index_version
           FROM cowork_artifact_index_state
           WHERE session_id = ?`,
        )
        .get(sessionId) as ArtifactIndexStateRow | undefined;
      const rebuild = !state || state.index_version !== COWORK_ARTIFACT_INDEX_VERSION;
      const cursor = rebuild ? 0 : state.cursor_sequence;

      if (rebuild) {
        this.db.prepare('DELETE FROM cowork_session_artifacts WHERE session_id = ?').run(sessionId);
      }

      const rows = this.db
        .prepare(
          `SELECT id, type, content, metadata, created_at, sequence
           FROM cowork_messages
           WHERE session_id = ? AND sequence > ?
           ORDER BY sequence ASC`,
        )
        .all(sessionId, cursor) as MessageRow[];
      const messages = rows.map(row => this.mapMessage(row));
      for (const candidate of collectSessionArtifactCandidates(messages)) {
        this.upsertCandidate(sessionId, candidate);
      }

      const nextCursor = rows.length > 0 ? rows[rows.length - 1].sequence : cursor;
      this.db
        .prepare(
          `INSERT INTO cowork_artifact_index_state
             (session_id, cursor_sequence, index_version)
           VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             cursor_sequence = excluded.cursor_sequence,
             index_version = excluded.index_version`,
        )
        .run(sessionId, nextCursor, COWORK_ARTIFACT_INDEX_VERSION);

      return this.readSession(sessionId);
    })();
  }

  listSession(sessionId: string): CoworkPersistedArtifact[] {
    const state = this.db
      .prepare(
        `SELECT index_version
         FROM cowork_artifact_index_state
         WHERE session_id = ?`,
      )
      .get(sessionId) as Pick<ArtifactIndexStateRow, 'index_version'> | undefined;
    if (!state || state.index_version !== COWORK_ARTIFACT_INDEX_VERSION) {
      return this.refreshSession(sessionId);
    }

    return this.readSession(sessionId);
  }

  private readSession(sessionId: string): CoworkPersistedArtifact[] {
    const rows = this.db
      .prepare(
        `SELECT id, message_id, type, title, content, language, file_name,
                file_path, source, role, declared, created_at
         FROM cowork_session_artifacts
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as ArtifactRow[];
    return rows.map(row => ({
      id: row.id,
      messageId: row.message_id,
      type: row.type,
      title: row.title,
      content: row.content,
      language: row.language ?? undefined,
      fileName: row.file_name ?? undefined,
      filePath: row.file_path ?? undefined,
      source: row.source,
      role: row.role,
      declared: Boolean(row.declared),
      createdAt: row.created_at,
    }));
  }

  private mapMessage(row: MessageRow): CoworkArtifactMessage {
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        // Message loading owns corrupt-metadata diagnostics. Artifact indexing
        // skips the same row silently so opening a session does not log twice.
      }
    }
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      timestamp: row.created_at,
      sequence: row.sequence,
      metadata,
    };
  }

  private upsertCandidate(sessionId: string, candidate: CoworkArtifactCandidate): void {
    const artifact = candidate.artifact;
    this.db
      .prepare(
        `INSERT INTO cowork_session_artifacts (
           session_id, artifact_key, id, message_id, type, title, content,
           language, file_name, file_path, source, role, declared, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, artifact_key) DO UPDATE SET
           id = CASE WHEN excluded.declared >= declared THEN excluded.id ELSE id END,
           message_id = CASE
             WHEN excluded.declared >= declared THEN excluded.message_id ELSE message_id END,
           type = CASE WHEN excluded.declared >= declared THEN excluded.type ELSE type END,
           title = CASE WHEN excluded.declared >= declared THEN excluded.title ELSE title END,
           content = CASE WHEN excluded.content <> '' THEN excluded.content ELSE content END,
           language = COALESCE(excluded.language, language),
           file_name = CASE
             WHEN excluded.declared >= declared THEN excluded.file_name ELSE file_name END,
           file_path = CASE
             WHEN excluded.declared >= declared THEN excluded.file_path ELSE file_path END,
           source = CASE WHEN excluded.declared >= declared THEN excluded.source ELSE source END,
           role = CASE WHEN excluded.declared >= declared THEN excluded.role ELSE role END,
           declared = MAX(declared, excluded.declared),
           created_at = CASE
             WHEN excluded.declared >= declared THEN excluded.created_at ELSE created_at END`,
      )
      .run(
        sessionId,
        candidate.artifactKey,
        artifact.id,
        artifact.messageId,
        artifact.type,
        artifact.title,
        artifact.content,
        artifact.language ?? null,
        artifact.fileName ?? null,
        artifact.filePath ?? null,
        artifact.source,
        artifact.role,
        artifact.declared ? 1 : 0,
        artifact.createdAt,
      );
  }
}
