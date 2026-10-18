/**
 * Artifact ledger: the single SQLite source of truth for file-backed
 * artifacts, written at event time (tool execution, workspace diff) instead
 * of being re-derived from message history.
 *
 * One row per (scope, normalized absolute path). Scopes are Cowork session
 * ids and coding lane ids. Recording is idempotent: re-recording a path
 * merges with the single merge rule in `mergeLedgerRow`.
 */
import { homedir } from 'os';
import path from 'path';

import type Database from 'better-sqlite3';

import {
  CoworkArtifactSource,
  type CoworkArtifactRole as CoworkArtifactRoleValue,
  type CoworkArtifactSource as CoworkArtifactSourceValue,
  type CoworkArtifactType,
  type CoworkPersistedArtifact,
} from '../../shared/cowork/artifacts';
import { resolveCoworkArtifactType } from '../../shared/cowork/artifactPreview';

/** Normalize a resolved path for the artifact key: unified separators; case
 * folded only on Windows, where paths are case-insensitive. */
export function normalizeArtifactKeyPath(filePath: string): string {
  const unified = filePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

export function artifactKeyForPath(filePath: string): string {
  return `path:${normalizeArtifactKeyPath(filePath)}`;
}

/**
 * Resolve a tool-supplied file path against a root, accepting the shapes the
 * model actually emits: absolute paths, `file://` URLs, `~` homes, and an
 * `@`-prefixed cwd-relative hint. Unicode spaces (NBSP) become normal spaces
 * because copy-pasted paths sometimes carry them.
 */
export function resolveArtifactInputPath(rawPath: string, root: string): string {
  let value = rawPath.trim();
  if (value.startsWith('@')) value = value.slice(1);
  if (/^file:\/\//i.test(value)) {
    // Normalize any number of leading slashes down to exactly one so
    // `file:///abs/path` keeps its absolute form and `file:///D:/x` becomes
    // a Windows drive path.
    value = value.replace(/^file:\/*/i, '/');
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep malformed percent-encoded paths unchanged.
    }
    // file:///D:/path arrives as /D:/path
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
  }
  value = value.replace(/\u00a0/g, ' ');
  const home = homedir();
  if (value === '~') value = home;
  else if (value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(home, value.slice(2));
  }
  return path.resolve(root, value);
}

export function getArtifactFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

export interface ArtifactLedgerRecordInput {
  /** Already resolved absolute path. */
  filePath: string;
  id: string;
  messageId: string;
  toolCallId?: string | null;
  runId?: string | null;
  type: CoworkArtifactType;
  title: string;
  content?: string;
  language?: string | null;
  source: CoworkArtifactSourceValue;
  role: CoworkArtifactRoleValue;
  declared?: boolean;
  createdAt: number;
}

interface RowShape {
  scope_id: string;
  artifact_key: string;
  id: string;
  message_id: string;
  tool_call_id: string | null;
  run_id: string | null;
  type: string;
  title: string;
  content: string;
  language: string | null;
  file_name: string | null;
  file_path: string;
  source: string;
  role: string;
  declared: number;
  created_at: number;
  updated_at: number;
}

/**
 * The one merge rule for artifact upserts (the only place artifact rows merge
 * on main):
 *
 * - Every touching event moves the anchor (id, message_id, tool_call_id,
 *   run_id) forward to that event; created_at always stays at first sighting.
 * - A file event refreshes file_path/file_name and observed content, and may
 *   refresh the type only while the row is undeclared; it never touches
 *   declared metadata (declared flag, role, title).
 * - A declaration (incoming.declared) sets declared=1, the role, the type
 *   resolved from `kind`, and the title when one was given.
 * - Observed content only replaces stored content when it is non-empty.
 */
export function mergeLedgerRow(
  existing: CoworkPersistedArtifact,
  incoming: CoworkPersistedArtifact,
): CoworkPersistedArtifact {
  const isDeclaration = incoming.declared;
  return {
    id: incoming.id,
    messageId: incoming.messageId,
    toolCallId: incoming.toolCallId ?? existing.toolCallId ?? null,
    runId: incoming.runId ?? existing.runId ?? null,
    type: isDeclaration ? incoming.type : existing.declared ? existing.type : incoming.type,
    title: isDeclaration ? incoming.title || existing.title : existing.title,
    content: incoming.content !== '' ? incoming.content : existing.content,
    language: incoming.language ?? existing.language,
    fileName: incoming.fileName ?? existing.fileName,
    filePath: incoming.filePath ?? existing.filePath,
    source: incoming.source,
    role: isDeclaration ? incoming.role : existing.role,
    declared: existing.declared || incoming.declared,
    createdAt: existing.createdAt,
  };
}

export interface ArtifactLedgerAnnotateInput {
  /** Already resolved absolute path. */
  filePath: string;
  role: CoworkArtifactRoleValue;
  /** Declared title; when omitted an existing title is kept and new rows fall
   * back to the file name. */
  title?: string;
  /** Kind hint resolved through resolveCoworkArtifactType. */
  kind?: string;
  messageId: string;
  toolCallId?: string | null;
  runId?: string | null;
}

export class ArtifactLedger {
  constructor(private readonly db: Database.Database) {}

  /**
   * Record (or merge) a file-backed artifact for a scope and return the
   * resulting row. Unknown inputs are ignored with `null`.
   */
  recordFile(scopeId: string, input: ArtifactLedgerRecordInput): CoworkPersistedArtifact | null {
    const artifactKey = artifactKeyForPath(input.filePath);
    const incoming: CoworkPersistedArtifact = {
      id: input.id,
      messageId: input.messageId,
      toolCallId: input.toolCallId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      title: input.title,
      content: input.content ?? '',
      language: input.language ?? undefined,
      fileName: getArtifactFileName(input.filePath),
      filePath: input.filePath,
      source: input.source,
      role: input.role,
      declared: input.declared === true,
      createdAt: input.createdAt,
    };
    return this.db.transaction(() => {
      const existingRow = this.readRow(scopeId, artifactKey);
      const merged = existingRow ? mergeLedgerRow(existingRow, incoming) : incoming;
      this.writeRow(scopeId, artifactKey, merged);
      return merged;
    })();
  }

  /**
   * Apply a declare_artifact annotation: set declared=1, the role and the
   * type resolved from `kind`, and the title when given. Creates the row when
   * the file was never observed. Returns the resulting row for publishing.
   */
  annotate(scopeId: string, input: ArtifactLedgerAnnotateInput): CoworkPersistedArtifact {
    const artifactKey = artifactKeyForPath(input.filePath);
    return this.db.transaction(() => {
      const existing = this.readRow(scopeId, artifactKey);
      const givenTitle = input.title?.trim() ?? '';
      const incoming: CoworkPersistedArtifact = {
        id: `artifact-declare-${input.toolCallId ?? input.messageId}`,
        messageId: input.messageId,
        toolCallId: input.toolCallId ?? null,
        runId: input.runId ?? null,
        type: resolveCoworkArtifactType(input.filePath, input.kind) ?? 'unsupported',
        // The merge rule treats '' as "no title given"; new rows need one.
        title: existing ? givenTitle : givenTitle || getArtifactFileName(input.filePath),
        content: '',
        fileName: getArtifactFileName(input.filePath),
        filePath: input.filePath,
        source: CoworkArtifactSource.Tool,
        role: input.role,
        declared: true,
        createdAt: Date.now(),
      };
      const merged = existing ? mergeLedgerRow(existing, incoming) : incoming;
      this.writeRow(scopeId, artifactKey, merged);
      return merged;
    })();
  }

  list(scopeId: string): CoworkPersistedArtifact[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifact_ledger WHERE scope_id = ? ORDER BY created_at ASC, id ASC`)
      .all(scopeId) as RowShape[];
    return rows.map(row => this.mapRow(row));
  }

  deleteScope(scopeId: string): void {
    this.db.prepare('DELETE FROM artifact_ledger WHERE scope_id = ?').run(scopeId);
  }

  private readRow(scopeId: string, artifactKey: string): CoworkPersistedArtifact | null {
    const row = this.db
      .prepare('SELECT * FROM artifact_ledger WHERE scope_id = ? AND artifact_key = ?')
      .get(scopeId, artifactKey) as RowShape | undefined;
    return row ? this.mapRow(row) : null;
  }

  private writeRow(scopeId: string, artifactKey: string, artifact: CoworkPersistedArtifact): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO artifact_ledger (
           scope_id, artifact_key, id, message_id, tool_call_id, run_id, type, title,
           content, language, file_name, file_path, source, role, declared,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_id, artifact_key) DO UPDATE SET
           id = excluded.id,
           message_id = excluded.message_id,
           tool_call_id = excluded.tool_call_id,
           run_id = excluded.run_id,
           type = excluded.type,
           title = excluded.title,
           content = excluded.content,
           language = excluded.language,
           file_name = excluded.file_name,
           file_path = excluded.file_path,
           source = excluded.source,
           role = excluded.role,
           declared = excluded.declared,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        scopeId,
        artifactKey,
        artifact.id,
        artifact.messageId,
        artifact.toolCallId ?? null,
        artifact.runId ?? null,
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
        now,
      );
  }

  private mapRow(row: RowShape): CoworkPersistedArtifact {
    return {
      id: row.id,
      messageId: row.message_id,
      toolCallId: row.tool_call_id,
      runId: row.run_id,
      type: row.type as CoworkArtifactType,
      title: row.title,
      content: row.content,
      language: row.language ?? undefined,
      fileName: row.file_name ?? undefined,
      filePath: row.file_path,
      source: row.source as CoworkArtifactSourceValue,
      role: row.role as CoworkArtifactRoleValue,
      declared: Boolean(row.declared),
      createdAt: row.created_at,
    };
  }
}
