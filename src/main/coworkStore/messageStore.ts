import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { CoworkMessageType, CoworkSessionStatus } from '../../shared/cowork/constants';

import { mapCoworkMessageRow, type CoworkMessageRow } from './helpers';
import type { CoworkMessage, CoworkMessageMetadata } from './types';

type TerminalSessionStatus = typeof CoworkSessionStatus.Idle | typeof CoworkSessionStatus.Error;

export function interruptedToolResult(
  toolUseId: string,
  content: string,
): Pick<CoworkMessage, 'type' | 'content' | 'metadata'> {
  return {
    type: CoworkMessageType.ToolResult,
    content,
    metadata: { toolUseId, isError: true, error: 'interrupted', isStreaming: false, isFinal: true },
  };
}

export class CoworkMessageStore {
  constructor(private readonly db: Database.Database) {}

  readSessionMessages(
    sessionId: string,
    messageLimit: number | null,
  ): { totalMessages: number; messageOffset: number; messages: CoworkMessage[] } {
    const totalMessages = this.countSessionMessages(sessionId);
    const limit = messageLimit === null ? totalMessages : Math.max(0, messageLimit);
    const messageOffset = Math.max(0, totalMessages - limit);
    const messages =
      limit === 0
        ? []
        : messageOffset > 0
          ? this.getPagedSessionMessages(sessionId, limit, messageOffset)
          : this.getSessionMessages(sessionId);
    return { totalMessages, messageOffset, messages };
  }

  countSessionMessages(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM cowork_messages WHERE session_id = ?')
      .get(sessionId) as { count: number } | undefined;
    return row?.count || 0;
  }

  /** Single-message lookup by id; readers must not materialize a page for one row. */
  getMessage(sessionId: string, messageId: string): CoworkMessage | null {
    const row = this.db
      .prepare<[string, string], CoworkMessageRow>(`
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE id = ? AND session_id = ?
    `)
      .get(messageId, sessionId);
    return row ? mapCoworkMessageRow(row, sessionId) : null;
  }

  getPagedSessionMessages(sessionId: string, limit: number, offset: number): CoworkMessage[] {
    // Single-level query: the previous wrapped form defeated the ordering
    // index and re-sorted the whole session per page (temp b-tree).
    const rows = this.db
      .prepare<[string, number, number], CoworkMessageRow>(`
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
      LIMIT ? OFFSET ?
    `)
      .all(sessionId, limit, offset);

    return rows.map(row => mapCoworkMessageRow(row, sessionId));
  }

  listOpenToolUseIds(sessionId: string, since?: number): string[] {
    const pageSize = 200;
    const readPage = this.db.prepare<
      [string, number, number, number],
      {
        type: CoworkMessage['type'];
        toolUseId: string | null;
      }
    >(`
      SELECT type, CASE WHEN type IN ('${CoworkMessageType.ToolUse}', '${CoworkMessageType.ToolResult}')
        AND json_valid(metadata) THEN
        CASE WHEN json_type(metadata, '$.toolUseId') = 'text'
          THEN json_extract(metadata, '$.toolUseId') END
        END AS toolUseId
      FROM cowork_messages
      WHERE session_id = ? AND created_at >= ?
      ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC
      LIMIT ? OFFSET ?
    `);
    const calls: string[] = [];
    const results = new Set<string>();
    // A recovered run can span steered user messages. For explicit stop, also read
    // the page containing the newest user message to close nearby orphan calls.
    for (let offset = 0; ; offset += pageSize) {
      const page = readPage.all(sessionId, since ?? Number.MIN_SAFE_INTEGER, pageSize, offset);
      for (const row of page) {
        if (!row.toolUseId) continue;
        if (row.type === CoworkMessageType.ToolUse) calls.push(row.toolUseId);
        else results.add(row.toolUseId);
      }
      if (
        page.length < pageSize ||
        (since === undefined && page.some(row => row.type === CoworkMessageType.User))
      )
        break;
    }
    return [...new Set(calls.reverse())].filter(id => !results.has(id));
  }

  /**
   * Whole-session message totals via SQL aggregate: the paged restore path no
   * longer materializes the transcript, but diagnostics still report its size.
   */
  getSessionMessageStats(sessionId: string): {
    messageCount: number;
    contentBytes: number;
    metadataBytes: number;
  } {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) AS messageCount,
          COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) AS contentBytes,
          COALESCE(SUM(LENGTH(CAST(COALESCE(metadata, '') AS BLOB))), 0) AS metadataBytes
        FROM cowork_messages
        WHERE session_id = ?
      `,
      )
      .get(sessionId) as
      | { messageCount: number; contentBytes: number; metadataBytes: number }
      | undefined;
    return {
      messageCount: row?.messageCount ?? 0,
      contentBytes: row?.contentBytes ?? 0,
      metadataBytes: row?.metadataBytes ?? 0,
    };
  }

  private getSessionMessages(sessionId: string): CoworkMessage[] {
    const rows = this.db
      .prepare<[string], CoworkMessageRow>(`
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY
        COALESCE(sequence, created_at) ASC,
        created_at ASC,
        ROWID ASC
    `)
      .all(sessionId);

    return rows.map(row => mapCoworkMessageRow(row, sessionId));
  }

  addMessage(
    sessionId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'>,
    timestamp?: number,
    status?: TerminalSessionStatus,
  ): CoworkMessage {
    const id = randomUUID();
    const now = timestamp ?? Date.now();

    const { sequence } = this.db.transaction(() => {
      const inserted = this.db
        .prepare<
          [string, string, string, string, string | null, number, string],
          { sequence: number }
        >(`
        INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
        VALUES (?, ?, ?, ?, ?, ?, (
          SELECT COALESCE(MAX(sequence), 0) + 1 FROM cowork_messages WHERE session_id = ?
        ))
        RETURNING sequence
      `)
        .get(
          id,
          sessionId,
          message.type,
          message.content,
          message.metadata ? JSON.stringify(message.metadata) : null,
          now,
          sessionId,
        )!;

      this.touchSession(sessionId, now, status);
      return inserted;
    })();

    return {
      id,
      type: message.type,
      content: message.content,
      timestamp: now,
      sequence,
      metadata: message.metadata,
    };
  }

  /**
   * Delete a message from a session.
   * Used by reconciliation to remove duplicate or spurious messages.
   */
  deleteMessage(sessionId: string, messageId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM cowork_messages WHERE id = ? AND session_id = ?')
      .run(messageId, sessionId);
    return result.changes > 0;
  }

  updateMessage(
    sessionId: string,
    messageId: string,
    updates: { content?: string; metadata?: CoworkMessageMetadata },
    options?: { touchUpdatedAt?: boolean; sessionStatus?: TerminalSessionStatus },
  ): boolean {
    const now = Date.now();
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.content !== undefined) {
      setClauses.push('content = ?');
      values.push(updates.content);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    if (setClauses.length === 0) return false;

    values.push(messageId);
    values.push(sessionId);
    const update = this.db.prepare(
      `
      UPDATE cowork_messages
      SET ${setClauses.join(', ')}
      WHERE id = ? AND session_id = ?
    `,
    );
    if (options?.touchUpdatedAt === false) {
      return update.run(...values).changes > 0;
    }
    return this.db.transaction(() => {
      if (update.run(...values).changes === 0) return false;
      this.touchSession(sessionId, now, options?.sessionStatus);
      return true;
    })();
  }

  private touchSession(sessionId: string, now: number, status?: TerminalSessionStatus): void {
    if (status === undefined) {
      this.db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    } else {
      this.db
        .prepare('UPDATE cowork_sessions SET updated_at = ?, status = ? WHERE id = ?')
        .run(now, status, sessionId);
    }
  }
}
