import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { AgentControlState } from './state.js';
import { InboxState } from './types.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agent control state', () => {
  test('migrates a legacy database and persists the schema version', () => {
    const directory = createTemporaryDirectory();
    const databasePath = path.join(directory, 'legacy.sqlite');
    const { DatabaseSync } = process.getBuiltinModule(
      'node:sqlite',
    ) as typeof import('node:sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec('CREATE TABLE agent_control_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    legacy
      .prepare('INSERT INTO agent_control_kv(key,value) VALUES(?,?)')
      .run('legacy', 'preserved');
    legacy.close();

    const state = new AgentControlState(databasePath);
    const database = new DatabaseSync(databasePath);
    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(
      database.prepare('SELECT value FROM agent_control_kv WHERE key=?').get('legacy'),
    ).toEqual({
      value: 'preserved',
    });
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .get('idx_agent_control_inbox_pending'),
    ).toEqual({ name: 'idx_agent_control_inbox_pending' });
    database.close();
    state.close();
  });

  test('rejects a database created by a newer extension', () => {
    const directory = createTemporaryDirectory();
    const databasePath = path.join(directory, 'future.sqlite');
    const { DatabaseSync } = process.getBuiltinModule(
      'node:sqlite',
    ) as typeof import('node:sqlite');
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA user_version = 99');
    database.close();

    expect(() => new AgentControlState(databasePath)).toThrow('newer than supported version 2');
  });

  test('persists inbox, outbox, cursor, and managed Skills across restarts', () => {
    const directory = createTemporaryDirectory();
    const databasePath = path.join(directory, 'agent-control.sqlite');
    const managedPath = path.join(directory, 'skills', 'demo');
    const first = new AgentControlState(databasePath);

    first.setValue('control_cursor', '42');
    first.persistInbox(controlEvent('delivery-1'));
    first.persistInbox(controlEvent('delivery-1'));
    first.setInboxState('delivery-1', InboxState.Running);
    first.enqueueTelemetry({ eventId: 'telemetry-1', type: 'skill.sync.completed' });
    first.enqueueTelemetry({ eventId: 'telemetry-1', type: 'skill.sync.failed' });
    first.setManagedSkill({
      skillId: 'demo',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      path: managedPath,
    });
    first.close();

    const second = new AgentControlState(databasePath);
    expect(second.getValue('control_cursor')).toBe('42');
    expect(second.listPendingInbox()).toEqual([
      expect.objectContaining({ deliveryId: 'delivery-1', state: InboxState.Running }),
    ]);
    expect(second.listTelemetry()).toEqual([
      { eventId: 'telemetry-1', type: 'skill.sync.completed' },
    ]);
    expect(second.managedSkills()).toEqual([
      {
        skillId: 'demo',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        path: managedPath,
      },
    ]);
    second.close();
  });

  test('keeps retryable failures pending and excludes completed or terminal work', () => {
    const directory = createTemporaryDirectory();
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    try {
      for (const deliveryId of ['retry', 'succeeded', 'terminal']) {
        state.persistInbox(controlEvent(deliveryId));
      }
      state.setInboxState('retry', InboxState.Failed);
      state.setInboxState('succeeded', InboxState.Succeeded);
      state.setInboxState('terminal', InboxState.Terminal);

      expect(state.listPendingInbox().map(item => item.deliveryId)).toEqual(['retry']);
    } finally {
      state.close();
    }
  });

  test('removes only telemetry IDs accepted by the control service', () => {
    const directory = createTemporaryDirectory();
    const state = new AgentControlState(path.join(directory, 'state.sqlite'));
    try {
      state.enqueueTelemetry({ eventId: 'accepted', type: 'skill.sync.completed' });
      state.enqueueTelemetry({ eventId: 'retry', type: 'skill.sync.failed' });
      state.removeTelemetry(['accepted']);

      expect(state.listTelemetry()).toEqual([{ eventId: 'retry', type: 'skill.sync.failed' }]);
    } finally {
      state.close();
    }
  });
});

function controlEvent(deliveryId: string) {
  return {
    deliveryId,
    eventId: `event-${deliveryId}`,
    cursor: '1',
    type: 'skill.manifest.changed',
    scope: { type: 'global' as const },
    task: { type: 'skill.reconcile' },
    createdAt: '2026-08-26T00:00:00.000Z',
    expiresAt: '2026-08-27T00:00:00.000Z',
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-agent-state-'));
  temporaryDirectories.push(directory);
  return directory;
}
