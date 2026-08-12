import type Database from 'better-sqlite3';

export const ChannelInboxStatus = {
  Pending: 'pending',
  Processing: 'processing',
  Completed: 'completed',
  Error: 'error',
} as const;
export type ChannelInboxStatus = (typeof ChannelInboxStatus)[keyof typeof ChannelInboxStatus];

export type ChannelInboxEvent = {
  platform: string;
  accountId: string;
  conversationId: string;
  messageId: string;
  payload: string;
};

export type ChannelInboxRecord = ChannelInboxEvent & {
  status: ChannelInboxStatus;
  result: string | null;
  error: string | null;
};

type ChannelInboxRow = {
  platform: string;
  account_id: string;
  conversation_id: string;
  message_id: string;
  payload_json: string;
  status: ChannelInboxStatus;
  result: string | null;
  error: string | null;
};

export class ChannelInboxStore {
  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_inbox (
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, account_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_channel_inbox_conversation_status
        ON channel_inbox(account_id, conversation_id, status, created_at);
    `);
  }

  claim(event: ChannelInboxEvent): ChannelInboxRecord {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO channel_inbox
      (platform, account_id, conversation_id, message_id, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.platform, event.accountId, event.conversationId, event.messageId, event.payload,
        ChannelInboxStatus.Pending, now, now);
    const existing = this.get(event.platform, event.accountId, event.messageId);
    if (!existing) throw new Error('Channel inbox claim did not create or find a record');
    return existing;
  }

  markProcessing(event: ChannelInboxEvent): void {
    this.db.prepare(`UPDATE channel_inbox SET status = ?, error = NULL, updated_at = ?
      WHERE platform = ? AND account_id = ? AND message_id = ?`)
      .run(ChannelInboxStatus.Processing, new Date().toISOString(), event.platform, event.accountId, event.messageId);
  }

  complete(event: ChannelInboxEvent, result: string): void {
    this.db.prepare(`UPDATE channel_inbox SET status = ?, result = ?, error = NULL, updated_at = ?
      WHERE platform = ? AND account_id = ? AND message_id = ?`)
      .run(ChannelInboxStatus.Completed, result, new Date().toISOString(), event.platform, event.accountId, event.messageId);
  }

  fail(event: ChannelInboxEvent, error: string): void {
    this.db.prepare(`UPDATE channel_inbox SET status = ?, error = ?, updated_at = ?
      WHERE platform = ? AND account_id = ? AND message_id = ?`)
      .run(ChannelInboxStatus.Error, error, new Date().toISOString(), event.platform, event.accountId, event.messageId);
  }

  recoverInterrupted(): number {
    return this.db.prepare(`UPDATE channel_inbox SET status = ?, error = NULL, updated_at = ? WHERE status = ?`)
      .run(ChannelInboxStatus.Pending, new Date().toISOString(), ChannelInboxStatus.Processing).changes;
  }

  private get(platform: string, accountId: string, messageId: string): ChannelInboxRecord | null {
    const row = this.db.prepare(`SELECT platform, account_id, conversation_id, message_id, payload_json,
      status, result, error FROM channel_inbox WHERE platform = ? AND account_id = ? AND message_id = ?`)
      .get(platform, accountId, messageId) as ChannelInboxRow | undefined;
    return row ? {
      platform: row.platform,
      accountId: row.account_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      payload: row.payload_json,
      status: row.status,
      result: row.result,
      error: row.error,
    } : null;
  }
}
