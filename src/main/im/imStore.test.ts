import { expect, test } from 'vitest';

import { getCcConnectScopedConversationId } from './ccConnectConversationId';
import { IMStore } from './imStore';

class FakeDb {
  private store: Map<string, string> = new Map();
  private mappings: Map<
    string,
    {
      im_conversation_id: string;
      platform: string;
      cowork_session_id: string;
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
            created_at: Number(params[3]),
            last_active_at: Number(params[4]),
          };
          this.mappings.set(this.mappingKey(row.im_conversation_id, row.platform), row);
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
        if (sql.includes('FROM channel_session_mappings')) {
          const rows = Array.from(this.mappings.values());
          return sql.includes('WHERE platform = ?')
            ? rows.filter(row => row.platform === String(params[0]))
            : rows;
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

test('scheduled task delivery reads the current conversation and account from the mapping', () => {
  const store = new IMStore(new FakeDb() as unknown as ConstructorParameters<typeof IMStore>[0]);
  expect(store.getScheduledTaskDelivery('work')).toBeNull();
  store.createSessionMapping('legacy', 'dingtalk', 'work');
  expect(store.getScheduledTaskDelivery('work')).toEqual({
    mode: 'announce',
    channel: 'dingtalk',
    to: 'legacy',
  });
  store.deleteSessionMapping('legacy', 'dingtalk');
  store.createSessionMapping(
    getCcConnectScopedConversationId('acct', 'native'),
    'dingtalk',
    'work',
  );
  expect(store.getScheduledTaskDelivery('work')).toEqual({
    mode: 'announce',
    channel: 'dingtalk',
    to: 'native',
    accountId: 'acct',
  });
});

test('IMStore filters scoped conversations by complete channel account ID', () => {
  const db = new FakeDb();
  const store = new IMStore(db as unknown as ConstructorParameters<typeof IMStore>[0]);
  const firstAccount = 'eb74163d-9aaa-4186-a526-36f249ca883b';
  const secondAccount = 'eb74163d-9aaa-4186-a526-000000000000';
  store.createSessionMapping(
    getCcConnectScopedConversationId(firstAccount, 'group:one'),
    'dingtalk',
    'cowork-1',
  );
  store.createSessionMapping(
    getCcConnectScopedConversationId(secondAccount, 'group:two'),
    'dingtalk',
    'cowork-2',
  );

  expect(store.listSessionMappings('dingtalk', firstAccount)).toMatchObject([
    { coworkSessionId: 'cowork-1' },
  ]);
});
