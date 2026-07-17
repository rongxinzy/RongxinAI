import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { IMStore } = require('../dist-electron/main/im/imStore.js');

test('IMStore persists conversation reply routes by platform and conversation ID', (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const store = new IMStore(db);

  assert.equal(store.getConversationReplyRoute('dingtalk', '__default__:conv-1'), null);

  store.setConversationReplyRoute('dingtalk', '__default__:conv-1', {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });

  assert.deepEqual(store.getConversationReplyRoute('dingtalk', '__default__:conv-1'), {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });
  assert.equal(store.getConversationReplyRoute('telegram', '__default__:conv-1'), null);
});
