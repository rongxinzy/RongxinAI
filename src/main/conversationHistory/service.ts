import type Database from 'better-sqlite3';

import type { ProjectIdentity } from '../memory/projectIdentity';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { planRecallQuery } from '../memory/recallQueryPlanner';
import { ConversationHistoryRole, type ConversationHistoryRole as Role } from './constants';

const DEFAULT_RESULT_LIMIT = 6;
const MAX_RESULT_LIMIT = 12;
const MAX_CANDIDATE_MULTIPLIER = 6;
const MAX_SNIPPET_CHARACTERS = 600;

interface HistoryRow {
  id: string;
  session_id: string;
  session_title: string;
  type: Role;
  content: string;
  metadata: string | null;
  created_at: number;
}

export interface ConversationHistoryMatch {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  role: Role;
  snippet: string;
  createdAt: number;
}

export class ConversationHistoryService {
  private readonly projectIdByDirectory = new Map<string, string>();

  constructor(
    private readonly db: Database.Database,
    private readonly resolveIdentity: (cwd: string) => ProjectIdentity = resolveProjectIdentity,
  ) {}

  search(input: {
    workingDirectory: string;
    query: string;
    limit?: number;
  }): ConversationHistoryMatch[] {
    const query = input.query.trim();
    if (!query) return [];
    const projectId = this.getProjectId(input.workingDirectory);
    const projectDirectories = this.listProjectDirectories(projectId);
    if (projectDirectories.length === 0) return [];
    const limit = normalizeLimit(input.limit);
    const exact = this.queryRows(projectDirectories, [query], limit).filter(
      row => !isThinkingMessage(row.metadata),
    );
    const rows =
      exact.length > 0
        ? exact
        : this.queryRows(projectDirectories, broadTerms(query), limit).filter(
            row => !isThinkingMessage(row.metadata),
          );
    return rows.slice(0, limit).map(row => ({
      messageId: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      role: row.type,
      snippet: buildSnippet(row.content, query),
      createdAt: row.created_at,
    }));
  }

  private listProjectDirectories(projectId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT cwd FROM cowork_sessions
         WHERE cwd IS NOT NULL AND TRIM(cwd) <> ''`,
      )
      .all() as Array<{ cwd: string }>;
    return rows.map(row => row.cwd).filter(directory => this.getProjectId(directory) === projectId);
  }

  private getProjectId(directory: string): string {
    const cached = this.projectIdByDirectory.get(directory);
    if (cached) return cached;
    const projectId = this.resolveIdentity(directory).id;
    this.projectIdByDirectory.set(directory, projectId);
    return projectId;
  }

  private queryRows(directories: string[], terms: string[], limit: number): HistoryRow[] {
    if (terms.length === 0) return [];
    const directoryPlaceholders = directories.map(() => '?').join(', ');
    const termPredicates = terms
      .map(() => "LOWER(m.content) LIKE LOWER(?) ESCAPE '\\'")
      .join(' OR ');
    const candidateLimit = Math.min(limit * MAX_CANDIDATE_MULTIPLIER, MAX_RESULT_LIMIT * 10);
    return this.db
      .prepare(
        `SELECT m.id, m.session_id, s.title AS session_title, m.type, m.content,
                m.metadata, m.created_at
         FROM cowork_messages m
         INNER JOIN cowork_sessions s ON s.id = m.session_id
         WHERE s.cwd IN (${directoryPlaceholders})
           AND m.type IN (?, ?)
           AND (${termPredicates})
         ORDER BY m.created_at DESC, COALESCE(m.sequence, m.created_at) DESC
         LIMIT ?`,
      )
      .all(
        ...directories,
        ConversationHistoryRole.User,
        ConversationHistoryRole.Assistant,
        ...terms.map(term => `%${escapeLikePattern(term)}%`),
        candidateLimit,
      ) as HistoryRow[];
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_RESULT_LIMIT;
  return Math.min(Math.max(Math.floor(value), 1), MAX_RESULT_LIMIT);
}

function broadTerms(query: string): string[] {
  const plan = planRecallQuery(query);
  const source = plan.broadQuery ?? query;
  return [
    ...new Set(
      source
        .split(/\s+/u)
        .map(term => term.trim())
        .filter(Boolean),
    ),
  ];
}

function isThinkingMessage(metadata: string | null): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as { isThinking?: unknown };
    return parsed.isThinking === true;
  } catch {
    return false;
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function buildSnippet(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_SNIPPET_CHARACTERS) return normalized;
  const terms = broadTerms(query);
  const lowerContent = normalized.toLocaleLowerCase();
  const matchIndex = terms.reduce((best, term) => {
    const index = lowerContent.indexOf(term.toLocaleLowerCase());
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  const start = Math.max(0, (matchIndex < 0 ? 0 : matchIndex) - MAX_SNIPPET_CHARACTERS / 3);
  const end = Math.min(normalized.length, start + MAX_SNIPPET_CHARACTERS);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`;
}
