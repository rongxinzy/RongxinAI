import type Database from 'better-sqlite3';

import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import type { MemoryOutboxItem } from './repository';

const CLAIM_LEASE_MS = 60_000;

export interface MemoryOutboxClaim {
  item: MemoryOutboxItem | null;
  completedMemoryId: number | null;
}

interface OutboxRow {
  id: string;
  link_id: string | null;
  operation: MemoryOutboxOperation;
  payload_json: string;
  status: string;
  attempts: number;
  available_at: string;
  last_error: string | null;
}

export function claimMemoryOutboxItem(db: Database.Database, id: string): MemoryOutboxClaim {
  const current = db
    .prepare('SELECT status, payload_json FROM memory_outbox WHERE id = ?')
    .get(id) as { status: string; payload_json: string } | undefined;
  if (!current) return { item: null, completedMemoryId: null };
  if (current.status === MemoryOutboxStatus.Completed) {
    const payload = JSON.parse(current.payload_json) as { linkId?: string };
    if (!payload.linkId) return { item: null, completedMemoryId: null };
    const link = db
      .prepare('SELECT memory_id FROM memory_links WHERE id = ?')
      .get(payload.linkId) as { memory_id: number } | undefined;
    return { item: null, completedMemoryId: link?.memory_id ?? null };
  }
  const claimed = db
    .prepare(
      `UPDATE memory_outbox SET available_at = ?
       WHERE id = ? AND status = ? AND available_at <= ?`,
    )
    .run(
      new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
      id,
      MemoryOutboxStatus.Pending,
      new Date().toISOString(),
    );
  if (claimed.changes !== 1) return { item: null, completedMemoryId: null };
  const row = db
    .prepare(
      `SELECT id, link_id, operation, payload_json, status, attempts, available_at, last_error
       FROM memory_outbox WHERE id = ?`,
    )
    .get(id) as OutboxRow;
  return {
    item: {
      id: row.id,
      linkId: row.link_id,
      operation: row.operation,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      status: row.status,
      attempts: row.attempts,
      availableAt: row.available_at,
      lastError: row.last_error,
    },
    completedMemoryId: null,
  };
}
