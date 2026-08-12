import { expect, test } from 'vitest';

import { IMStore } from './imStore';

class FakeDb {
  private store: Map<string, string> = new Map();
  private mappings: Map<
    string,
    {
      im_conversation_id: string;
      platform: string;
      cowork_session_id: string;
      transport_session_key: string | null;
      created_at: number;
      last_active_at: number;
    }
  > = new Map();
  private deletedPlatforms: string[] = [];
  writeCount = 0;

  pragma() {
    return [
      { name: 'im_conversation_id' },
      { name: 'platform' },
      { name: 'cowork_session_id' },
      { name: 'transport_session_key' },
      { name: 'created_at' },
      { name: 'last_active_at' },
    ];
  }

  transaction<T extends (...args: never[]) => unknown>(operation: T): T {
    return operation;
  }

  exec() {}

  prepare(sql: string) {
    return {
      run: (...params: unknown[]) => {
        if (sql.includes('INSERT') && sql.includes('im_config')) {
          this.store.set(String(params[0]), String(params[1]));
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE im_config')) {
          // UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?
          this.store.set(String(params[2]), String(params[0]));
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM im_config WHERE key = ?')) {
          this.store.delete(String(params[0]));
          this.writeCount++;
          return;
        }
        if (sql.includes('INSERT INTO channel_session_mappings')) {
          const row = {
            im_conversation_id: String(params[0]),
            platform: String(params[1]),
            cowork_session_id: String(params[2]),
            transport_session_key: params[3] ? String(params[3]) : null,
            created_at: Number(params[4]),
            last_active_at: Number(params[5]),
          };
          this.mappings.set(this.mappingKey(row.im_conversation_id, row.platform), row);
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE channel_session_mappings SET transport_session_key = ?')) {
          const key = this.mappingKey(String(params[2]), String(params[3]));
          const row = this.mappings.get(key);
          if (row) {
            row.transport_session_key = String(params[0]);
            row.last_active_at = Number(params[1]);
          }
          this.writeCount++;
          return;
        }
        if (sql.includes('UPDATE channel_session_mappings SET last_active_at = ?')) {
          const key = this.mappingKey(String(params[1]), String(params[2]));
          const row = this.mappings.get(key);
          if (row) {
            row.last_active_at = Number(params[0]);
          }
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM channel_session_mappings WHERE im_conversation_id = ?')) {
          this.mappings.delete(this.mappingKey(String(params[0]), String(params[1])));
          this.writeCount++;
          return;
        }
        if (sql.includes('DELETE FROM channel_session_mappings WHERE cowork_session_id = ?')) {
          const target = String(params[0]);
          for (const [key, row] of this.mappings.entries()) {
            if (row.cowork_session_id === target) {
              this.mappings.delete(key);
            }
          }
          this.writeCount++;
          return;
        }
        // CREATE TABLE, ALTER TABLE, etc: count as write
        this.writeCount++;
      },
      get: (...params: unknown[]) => {
        if (sql.includes('SELECT value FROM im_config WHERE key = ?')) {
          const value = this.store.get(String(params[0]));
          return value !== undefined ? { value } : undefined;
        }
        if (sql.includes('FROM channel_session_mappings WHERE im_conversation_id = ?')) {
          return this.mappings.get(this.mappingKey(String(params[0]), String(params[1])));
        }
        if (sql.includes('FROM channel_session_mappings WHERE cowork_session_id = ?')) {
          const target = String(params[0]);
          return Array.from(this.mappings.values()).find(row => row.cowork_session_id === target);
        }
        return undefined;
      },
      all: (...params: unknown[]) => {
        if (sql.includes('SELECT key, value FROM im_config WHERE key LIKE ?')) {
          const prefix = String(params[0]).replace('%', '');
          return Array.from(this.store.entries())
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value }));
        }
        return [];
      },
    };
  }

  private mappingKey(imConversationId: string, platform: string) {
    return `${platform}\0${imConversationId}`;
  }

  getValue(key: string) {
    return this.store.get(key);
  }

  getDeletedPlatforms() {
    return this.deletedPlatforms;
  }
}

test('IMStore persists conversation reply routes by platform and conversation ID', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);

  expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toBe(null);

  store.setConversationReplyRoute('dingtalk', '__default__:conv-1', {
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });

  expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toEqual({
    channel: 'dingtalk-connector',
    to: 'group:cid-42',
    accountId: '__default__',
  });
  expect(store.getConversationReplyRoute('telegram', '__default__:conv-1')).toBe(null);
  expect(db.writeCount >= 2).toBeTruthy();
});

test('IMStore persists cc-connect native session routes separately by account', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);

  store.setCcConnectSessionKey('telegram-a', 'telegram', '42', 'telegram:42');
  store.setCcConnectSessionKey('telegram-b', 'telegram', '42', 'telegram:42:other-bot');

  expect(store.getCcConnectSessionKey('telegram-a', 'telegram', '42')).toBe('telegram:42');
  expect(store.getCcConnectSessionKey('telegram-b', 'telegram', '42')).toBe(
    'telegram:42:other-bot',
  );
  expect(store.getCcConnectSessionKey('telegram-a', 'telegram', '43')).toBe(null);
});

test('IMStore persists transport session keys in channel session mappings', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);

  store.createSessionMapping(
    'bot-1:direct:user-1',
    'weixin',
    'cowork-1',
    'weixin:bot-1:direct:user-1',
  );

  expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')).toMatchObject({
    imConversationId: 'bot-1:direct:user-1',
    platform: 'weixin',
    coworkSessionId: 'cowork-1',
    transportSessionKey: 'weixin:bot-1:direct:user-1',
  });
  expect(store.getSessionMappingByCoworkSessionId('cowork-1')?.transportSessionKey).toBe(
    'weixin:bot-1:direct:user-1',
  );

  store.updateSessionTransportSessionKey(
    'bot-1:direct:user-1',
    'weixin',
    'weixin:bot-1:direct:user-2',
  );

  expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')?.transportSessionKey).toBe(
    'weixin:bot-1:direct:user-2',
  );
});
