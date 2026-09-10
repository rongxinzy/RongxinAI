import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { type McpCredentialStore, McpStore } from './mcpStore';

const createCredentialStore = (): McpCredentialStore => {
  const records = new Map<
    string,
    { env?: Record<string, string>; headers?: Record<string, string> }
  >();
  return {
    get: serverId => records.get(serverId),
    set: (serverId, payload) => records.set(serverId, payload),
    delete: serverId => records.delete(serverId),
  };
};

const createTestDb = (): Database.Database => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      transport_type TEXT NOT NULL DEFAULT 'stdio',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
};

test('createServer keeps new MCP servers disabled until explicitly enabled', () => {
  const db = createTestDb();
  const store = new McpStore(db);

  const created = store.createServer({
    name: 'Example MCP',
    description: 'example',
    transportType: 'http',
    url: 'http://localhost:3000/mcp',
  });

  expect(created.enabled).toBe(false);
  expect(store.getEnabledServers()).toEqual([]);

  db.close();
});

test('stores MCP credentials outside config_json when a credential vault is configured', () => {
  const db = createTestDb();
  const store = new McpStore(db, createCredentialStore());

  const created = store.createServer({
    name: 'Secured MCP',
    description: 'example',
    transportType: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer secret-token' },
  });

  const row = db.prepare('SELECT config_json FROM mcp_servers WHERE id = ?').get(created.id) as {
    config_json: string;
  };
  expect(row.config_json).not.toContain('secret-token');
  expect(store.getServer(created.id)?.headers).toEqual({ Authorization: 'Bearer secret-token' });

  db.close();
});

test('migrates legacy plaintext MCP credentials out of config_json', () => {
  const db = createTestDb();
  const id = 'legacy-server';
  db.prepare(
    `INSERT INTO mcp_servers (id, name, description, enabled, transport_type, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'Legacy MCP',
    'example',
    0,
    'stdio',
    JSON.stringify({ command: 'node', env: { API_TOKEN: 'legacy-secret' } }),
    1,
    1,
  );
  const store = new McpStore(db, createCredentialStore());

  store.migrateLegacyCredentials();

  const row = db.prepare('SELECT config_json FROM mcp_servers WHERE id = ?').get(id) as {
    config_json: string;
  };
  expect(row.config_json).not.toContain('legacy-secret');
  expect(store.getServer(id)?.env).toEqual({ API_TOKEN: 'legacy-secret' });

  db.close();
});
