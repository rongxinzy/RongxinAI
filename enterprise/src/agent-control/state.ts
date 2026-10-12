import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

import type { ControlEvent, JsonObject } from '@aep/sdk-node';

import { type InboxItem, InboxState, type ManagedSkill } from './types.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const CURRENT_SCHEMA_VERSION = 2;

export class AgentControlState {
  readonly #database: DatabaseSyncType;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    try {
      this.#database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.#migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  #migrate(): void {
    const row = this.#database.prepare('PRAGMA user_version').get() as { user_version: number };
    const currentVersion = Number(row.user_version ?? 0);
    if (!Number.isInteger(currentVersion) || currentVersion < 0) {
      throw new Error('Agent control SQLite schema version is invalid.');
    }
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Agent control SQLite schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
      );
    }

    for (let version = currentVersion + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
      this.#database.exec('BEGIN IMMEDIATE');
      try {
        if (version === 1) this.#migrateToV1();
        if (version === 2) this.#migrateToV2();
        this.#database.exec(`PRAGMA user_version = ${version}`);
        this.#database.exec('COMMIT');
      } catch (error) {
        this.#database.exec('ROLLBACK');
        throw new Error(`Agent control SQLite migration to version ${version} failed.`, {
          cause: error,
        });
      }
    }
  }

  #migrateToV1(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS agent_control_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_control_inbox (
        delivery_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_control_outbox (
        event_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_control_skills (
        skill_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  #migrateToV2(): void {
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_control_inbox_pending
        ON agent_control_inbox(state, updated_at, delivery_id);
      CREATE INDEX IF NOT EXISTS idx_agent_control_outbox_created
        ON agent_control_outbox(created_at, event_id);
      CREATE INDEX IF NOT EXISTS idx_agent_control_skills_updated
        ON agent_control_skills(updated_at, skill_id);
    `);
  }

  close(): void {
    this.#database.close();
  }

  getValue(key: string): string | null {
    const row = this.#database
      .prepare('SELECT value FROM agent_control_kv WHERE key=?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setValue(key: string, value: string): void {
    this.#database
      .prepare(
        'INSERT INTO agent_control_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }

  persistInbox(event: ControlEvent): void {
    this.#database
      .prepare(
        'INSERT INTO agent_control_inbox(delivery_id,payload,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(delivery_id) DO NOTHING',
      )
      .run(event.deliveryId, JSON.stringify(event), InboxState.Received, new Date().toISOString());
  }

  listPendingInbox(): InboxItem[] {
    const rows = this.#database
      .prepare(
        'SELECT delivery_id,payload,state FROM agent_control_inbox WHERE state IN (?,?,?) ORDER BY updated_at,delivery_id',
      )
      .all(InboxState.Received, InboxState.Running, InboxState.Failed) as Array<{
      delivery_id: string;
      payload: string;
      state: InboxItem['state'];
    }>;
    return rows.map(row => ({
      deliveryId: row.delivery_id,
      event: JSON.parse(row.payload) as ControlEvent,
      state: row.state,
    }));
  }

  setInboxState(deliveryId: string, state: InboxState): void {
    this.#database
      .prepare('UPDATE agent_control_inbox SET state=?,updated_at=? WHERE delivery_id=?')
      .run(state, new Date().toISOString(), deliveryId);
  }

  enqueueTelemetry(event: JsonObject): void {
    const eventId = String(event.eventId ?? '');
    if (!eventId) throw new Error('Agent telemetry requires an event ID.');
    this.#database
      .prepare(
        'INSERT INTO agent_control_outbox(event_id,payload,created_at) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING',
      )
      .run(eventId, JSON.stringify(event), new Date().toISOString());
  }

  listTelemetry(limit = 100): JsonObject[] {
    const rows = this.#database
      .prepare('SELECT payload FROM agent_control_outbox ORDER BY created_at,event_id LIMIT ?')
      .all(limit) as Array<{ payload: string }>;
    return rows.map(row => JSON.parse(row.payload) as JsonObject);
  }

  removeTelemetry(eventIds: readonly string[]): void {
    if (eventIds.length === 0) return;
    const remove = this.#database.prepare('DELETE FROM agent_control_outbox WHERE event_id=?');
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      for (const eventId of eventIds) remove.run(eventId);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  managedSkills(): ManagedSkill[] {
    return this.#database
      .prepare(
        'SELECT skill_id AS skillId,version,sha256,path FROM agent_control_skills ORDER BY skill_id',
      )
      .all() as unknown as ManagedSkill[];
  }

  setManagedSkill(skill: ManagedSkill): void {
    this.#database
      .prepare(
        'INSERT INTO agent_control_skills(skill_id,version,sha256,path,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET version=excluded.version,sha256=excluded.sha256,path=excluded.path,updated_at=excluded.updated_at',
      )
      .run(skill.skillId, skill.version, skill.sha256, skill.path, new Date().toISOString());
  }

  removeManagedSkill(skillId: string): void {
    this.#database.prepare('DELETE FROM agent_control_skills WHERE skill_id=?').run(skillId);
  }
}
