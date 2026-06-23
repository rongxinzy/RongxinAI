import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { McpStore } from './mcpStore';

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
