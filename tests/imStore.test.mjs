import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { IMStore } = require('../dist-electron/main/im/imStore.js');
const { initializeIMSchema } = require('../dist-electron/main/im/schema.js');

test('IMStore persists the native delivery route by account and conversation', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  initializeIMSchema(db);
  const store = new IMStore(db);

  store.setCcConnectSessionKey('account-a', 'qq', 'group-42', 'qqbot:group:42');
  store.setCcConnectSessionKey('account-b', 'qq', 'group-42', 'qqbot:group:42:reply');

  assert.equal(store.getCcConnectSessionKey('account-a', 'qqbot', 'group-42'), 'qqbot:group:42');
  assert.equal(
    store.getCcConnectSessionKey('account-b', 'qqbot', 'group-42'),
    'qqbot:group:42:reply',
  );
  assert.equal(store.getCcConnectSessionKey('account-a', 'qqbot', 'group-43'), null);
});
