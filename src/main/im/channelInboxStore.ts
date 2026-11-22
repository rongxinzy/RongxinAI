import type Database from 'better-sqlite3';

const COMPLETED = 'completed';

export type ChannelInboxEvent = {
  platform: string;
  accountId: string;
  conversationId: string;
  messageId: string;
};

export class ChannelInboxStore {
  constructor(private readonly db: Database.Database) {}

  completedResult(event: ChannelInboxEvent): string | undefined {
    const row = this.db
      .prepare(`SELECT result FROM channel_inbox
        WHERE platform = ? AND account_id = ? AND message_id = ? AND status = ?`)
      .get(event.platform, event.accountId, event.messageId, COMPLETED) as
      | { result: string | null }
      | undefined;
    return row?.result || undefined;
  }

  complete(event: ChannelInboxEvent, result: string): string {
    const now = new Date().toISOString();
    // Existing databases require payload_json, although the transport owns redelivery.
    const written = this.db
      .prepare(`INSERT INTO channel_inbox
        (platform, account_id, conversation_id, message_id, payload_json, status, result, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)
        ON CONFLICT(platform, account_id, message_id) DO UPDATE SET
          status = excluded.status, result = excluded.result, updated_at = excluded.updated_at
        WHERE channel_inbox.status <> excluded.status
          OR channel_inbox.result IS NULL OR channel_inbox.result = ''`)
      .run(
        event.platform,
        event.accountId,
        event.conversationId,
        event.messageId,
        COMPLETED,
        result,
        now,
        now,
      );
    return written.changes ? result : this.completedResult(event)!;
  }
}
