// Message persistence for the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { v4 as uuidv4 } from 'uuid';

import { mapCoworkMessageRow, normalizeMessageTimestamp, type CoworkMessageRow } from './helpers';
import type {
  CoworkConversationReplacementEntry,
  CoworkMessage,
  CoworkMessageMetadata,
} from './types';
import { CoworkWorkspaceStore } from './workspaceStore';

export class CoworkMessageStore extends CoworkWorkspaceStore {
  countSessionMessages(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM cowork_messages WHERE session_id = ?')
      .get(sessionId) as { count: number } | undefined;
    return row?.count || 0;
  }

  getPagedSessionMessages(sessionId: string, limit: number, offset: number): CoworkMessage[] {
    // Single-level query: the previous wrapped form defeated the ordering
    // index and re-sorted the whole session per page (temp b-tree).
    const rows = this.getAll<CoworkMessageRow>(
      `
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
      LIMIT ? OFFSET ?
    `,
      [sessionId, limit, offset],
    );

    return rows.map(row => mapCoworkMessageRow(row, sessionId));
  }

  /**
   * Newest-first pages of a session's messages, for readers that fill a budget
   * from the tail and stop early (history restore on session rebuild). The
   * ordering key mirrors getPagedSessionMessages in reverse.
   */
  getSessionMessagesDesc(sessionId: string, limit: number, offset: number): CoworkMessage[] {
    const rows = this.getAll<CoworkMessageRow>(
      `
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY COALESCE(sequence, created_at) DESC, created_at DESC, ROWID DESC
      LIMIT ? OFFSET ?
    `,
      [sessionId, limit, offset],
    );

    return rows.map(row => mapCoworkMessageRow(row, sessionId));
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

  protected getSessionMessages(sessionId: string): CoworkMessage[] {
    const rows = this.getAll<CoworkMessageRow>(
      `
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY
        COALESCE(sequence, created_at) ASC,
        created_at ASC,
        ROWID ASC
    `,
      [sessionId],
    );

    return rows.map(row => mapCoworkMessageRow(row, sessionId));
  }

  addMessage(
    sessionId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'>,
    timestamp?: number,
  ): CoworkMessage {
    const id = uuidv4();
    const now = timestamp ?? Date.now();

    const seqRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM cowork_messages WHERE session_id = ?',
      )
      .get(sessionId) as { next_seq: number } | undefined;
    const sequence = seqRow?.next_seq ?? 1;

    this.db
      .prepare(
        `
      INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        sessionId,
        message.type,
        message.content,
        message.metadata ? JSON.stringify(message.metadata) : null,
        now,
        sequence,
      );

    this.db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

    return {
      id,
      type: message.type,
      content: message.content,
      timestamp: now,
      sequence,
      metadata: message.metadata,
    };
  }

  upsertMessage(sessionId: string, message: CoworkMessage): CoworkMessage {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT sequence FROM cowork_messages WHERE id = ? AND session_id = ?')
      .get(message.id, sessionId) as { sequence: number } | undefined;
    const sequence =
      existing?.sequence ??
      (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM cowork_messages WHERE session_id = ?',
          )
          .get(sessionId) as { next_seq: number } | undefined
      )?.next_seq ??
      1;

    this.db
      .prepare(
        `
        INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          content = excluded.content,
          metadata = excluded.metadata
      `,
      )
      .run(
        message.id,
        sessionId,
        message.type,
        message.content,
        message.metadata ? JSON.stringify(message.metadata) : null,
        message.timestamp,
        sequence,
      );
    this.db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    return {
      ...message,
      sequence,
    };
  }

  /**
   * Insert a message before an existing message (by shifting sequences).
   * Used for channel-originated sessions where user messages need to appear
   * before assistant messages that were created during streaming.
   */
  insertMessageBeforeId(
    sessionId: string,
    beforeMessageId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'>,
  ): CoworkMessage {
    const id = uuidv4();
    const now = Date.now();

    // Get the target message's sequence
    const targetRow = this.db
      .prepare('SELECT sequence FROM cowork_messages WHERE id = ? AND session_id = ?')
      .get(beforeMessageId, sessionId) as { sequence: number } | undefined;
    const targetSequence = targetRow?.sequence;

    if (targetSequence === undefined) {
      // Fallback to normal append if the target message is not found
      return this.addMessage(sessionId, message);
    }

    this.db.transaction(() => {
      // Shift all messages with sequence >= target up by 1
      this.db
        .prepare(
          'UPDATE cowork_messages SET sequence = sequence + 1 WHERE session_id = ? AND sequence >= ?',
        )
        .run(sessionId, targetSequence);

      // Insert at the target's original sequence
      this.db
        .prepare(
          `
        INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          sessionId,
          message.type,
          message.content,
          message.metadata ? JSON.stringify(message.metadata) : null,
          now,
          targetSequence,
        );

      this.db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    })();

    return {
      id,
      type: message.type,
      content: message.content,
      timestamp: now,
      sequence: targetSequence,
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

  /**
   * Replace all user/assistant messages in a session with the given list.
   * Tool messages (tool_use, tool_result, system) are preserved in their existing positions.
   * Used by history reconciliation to align local state with the authoritative gateway history.
   */
  replaceConversationMessages(
    sessionId: string,
    authoritative: CoworkConversationReplacementEntry[],
  ): void {
    const now = Date.now();

    this.db.transaction(() => {
      const existingRows = this.db
        .prepare(
          `
          SELECT type, content, created_at
          FROM cowork_messages
          WHERE session_id = ? AND type IN ('user', 'assistant')
          ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
        `,
        )
        .all(sessionId) as Array<{
        type: 'user' | 'assistant';
        content: string;
        created_at: number;
      }>;
      const existingTimestamps = new Map<string, number[]>();
      for (const row of existingRows) {
        const timestamp = normalizeMessageTimestamp(Number(row.created_at));
        if (timestamp == null) continue;
        const key = `${row.type}\x1f${row.content}`;
        const timestamps = existingTimestamps.get(key) ?? [];
        timestamps.push(timestamp);
        existingTimestamps.set(key, timestamps);
      }

      // Delete all existing user/assistant messages for this session
      this.db
        .prepare(
          "DELETE FROM cowork_messages WHERE session_id = ? AND type IN ('user', 'assistant')",
        )
        .run(sessionId);

      // Re-insert authoritative messages with correct sequence numbers
      // First, get the current max sequence from remaining messages (tool_use, tool_result, system)
      const seqRow = this.db
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) as max_seq FROM cowork_messages WHERE session_id = ?',
        )
        .get(sessionId) as { max_seq: number } | undefined;
      let nextSeq = (seqRow?.max_seq ?? 0) + 1;
      const insertedTimestamps: number[] = [];

      for (const entry of authoritative) {
        const id = uuidv4();
        const baseMetadata = { isStreaming: false, isFinal: true };
        const finalMetadata = entry.metadata
          ? { ...baseMetadata, ...entry.metadata }
          : baseMetadata;
        const existingKey = `${entry.role}\x1f${entry.text}`;
        const matchingExistingTimestamps = existingTimestamps.get(existingKey);
        const existingTimestamp = matchingExistingTimestamps?.shift();
        const messageTimestamp =
          normalizeMessageTimestamp(entry.timestamp) ?? existingTimestamp ?? now;
        insertedTimestamps.push(messageTimestamp);
        this.db
          .prepare(
            `
          INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            id,
            sessionId,
            entry.role,
            entry.text,
            JSON.stringify(finalMetadata),
            messageTimestamp,
            nextSeq++,
          );
      }

      const updatedAt =
        insertedTimestamps.length > 0 ? insertedTimestamps[insertedTimestamps.length - 1] : now;
      this.db
        .prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?')
        .run(updatedAt, sessionId);
    })();
  }

  updateMessage(
    sessionId: string,
    messageId: string,
    updates: { content?: string; metadata?: CoworkMessageMetadata },
    options?: { touchUpdatedAt?: boolean },
  ): void {
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

    if (setClauses.length === 0) return;

    values.push(messageId);
    values.push(sessionId);
    const result = this.db
      .prepare(
        `
      UPDATE cowork_messages
      SET ${setClauses.join(', ')}
      WHERE id = ? AND session_id = ?
    `,
      )
      .run(...values);
    if (result.changes > 0 && options?.touchUpdatedAt !== false) {
      this.db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    }
  }
}
